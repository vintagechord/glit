import { readFile } from "node:fs/promises";
import { ReviewExtractionError } from "./upload-validation";
import { REVIEW_DOC_LIMITS } from "./model";

const MiB = 1024 * 1024;
export const LOW_MEMORY_CONVERTER_RSS = 224 * MiB;
export const LOW_MEMORY_WEB_RESERVE = 64 * MiB;
export const lowMemoryReviewConversion = () => /^(true|1)$/i.test(process.env.REVIEW_DOCS_LOW_MEMORY ?? "");
export const converterTimeoutSeconds = () => lowMemoryReviewConversion() ? 240 : REVIEW_DOC_LIMITS.conversionSeconds;
export type ConverterMemory = { converterRss: number; used?: number; limit?: number };

/** Includes the Python reader and its OCR/antiword children, not the shared web process. */
async function converterRss(pid: number, visited = new Set<number>()): Promise<number> {
  if (visited.has(pid)) return 0;
  visited.add(pid);
  const [status, children] = await Promise.all([
    readFile(`/proc/${pid}/status`, "utf8").catch(() => ""),
    readFile(`/proc/${pid}/task/${pid}/children`, "utf8").catch(() => ""),
  ]);
  const own = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] ?? 0) * 1024;
  const descendants = children.trim().split(/\s+/).map(Number).filter(id => Number.isInteger(id) && id > 0);
  return own + (await Promise.all(descendants.map(id => converterRss(id, visited)))).reduce((sum, rss) => sum + rss, 0);
}

async function cgroupMemory(): Promise<Pick<ConverterMemory, "used" | "limit">> {
  for (const [usagePath, limitPath, statPath, inactiveKey] of [
    ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.stat", "inactive_file"],
    ["/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.stat", "total_inactive_file"],
  ]) {
    try {
      const [usage, maximum, stats] = await Promise.all([readFile(usagePath, "utf8"), readFile(limitPath, "utf8"), readFile(statPath, "utf8")]);
      const limit = Number(maximum.trim());
      if (!Number.isSafeInteger(limit) || limit <= 0) continue;
      const current = Number(usage.trim());
      const inactive = Number(stats.match(new RegExp(`^${inactiveKey} (\\d+)$`, "m"))?.[1] ?? 0);
      if (Number.isFinite(current)) return { limit, used: Math.max(0, current - inactive) };
    } catch { /* No bounded cgroup on this host; the converter RSS guard still applies. */ }
  }
  return {};
}

export function converterMemoryExceeded(memory: ConverterMemory): boolean {
  return memory.converterRss > LOW_MEMORY_CONVERTER_RSS ||
    (memory.limit !== undefined && memory.used !== undefined && memory.used > memory.limit - LOW_MEMORY_WEB_RESERVE);
}

export const converterMemoryError = () => new ReviewExtractionError("EXTRACTION_LIMIT", "웹 서버를 보호하기 위해 메모리 사용량이 큰 문서 변환을 중단했습니다. 페이지를 나누거나 DOCX로 저장 후 다시 업로드해주세요.");

export async function assertConverterMemoryAvailable() {
  if (!lowMemoryReviewConversion() || process.platform !== "linux") return;
  const memory = await cgroupMemory();
  // Avoid launching an additional interpreter while the shared container is already near its limit.
  if (converterMemoryExceeded({ converterRss: 0, ...memory })) throw converterMemoryError();
}

export function watchConverterMemory(pid: number, stop: (error: ReviewExtractionError) => void) {
  if (!lowMemoryReviewConversion() || process.platform !== "linux") return () => {};
  let active = true;
  let reading = false;
  const check = async () => {
    if (!active || reading) return;
    reading = true;
    try {
      const [rss, cgroup] = await Promise.all([converterRss(pid), cgroupMemory()]);
      if (active && converterMemoryExceeded({ converterRss: rss, ...cgroup })) stop(converterMemoryError());
    } finally { reading = false; }
  };
  const timer = setInterval(() => { void check(); }, 500);
  timer.unref();
  void check();
  return () => { active = false; clearInterval(timer); };
}
