import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createAdminClient } from "../../src/lib/supabase/admin";
import { REVIEW_JOB_LIMITS, ReviewJobError, type ReviewJob } from "../../src/lib/review-docs/jobs-types";
import { cleanupReviewJobs, failReviewJob } from "../../src/lib/review-docs/worker";
import { safeReviewWorkerStartupError, startCheckedReviewWorker } from "./preflight";

loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
let stopped = false; let child: ChildProcess | null = null;
const kill = () => { if (child?.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } } };
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopped = true; kill(); });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(job: ReviewJob) {
  // A child process gives every job a hard deadline and bounded V8 memory.
  child = spawn(process.execPath, ["--max-old-space-size=384", "--import", "tsx", path.resolve("scripts/review-docs/process.ts"), job.id, job.lease_token!], { stdio: "inherit", detached: true, env: process.env });
  const running = child;
  const stopRunning = () => { if (running.pid) { try { process.kill(-running.pid, "SIGKILL"); } catch { /* already exited */ } } };
  const timer = setTimeout(stopRunning, REVIEW_JOB_LIMITS.processingSeconds * 1000);
  const heartbeat = setInterval(() => {
    void (async () => {
      const admin = createAdminClient();
      const { data, error } = await admin.from("review_document_jobs").update({ lease_until: new Date(Date.now() + 90000).toISOString() }).eq("id", job.id).eq("lease_token", job.lease_token!).select("id").maybeSingle();
      if (error || !data) { stopRunning(); return; }
      const { error: heartbeatError } = await admin.from("review_document_worker_heartbeat").upsert({ singleton: true, updated_at: new Date().toISOString() });
      if (heartbeatError) stopRunning();
    })().catch(stopRunning);
  }, 20000);
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => { child!.once("exit", resolve); child!.once("error", reject); });
    if (exitCode !== 0) await failReviewJob(job, new ReviewJobError("처리 시간이 초과되었거나 작업 프로세스가 종료되었습니다. 파일을 나누거나 워커 상태를 확인해주세요.", 503, "WORKER_INTERRUPTED", true));
  } finally { clearTimeout(timer); clearInterval(heartbeat); stopRunning(); child = null; }
}
async function main() {
  let cleanupAt = 0;
  while (!stopped) {
    try {
      const { data, error } = await createAdminClient().rpc("claim_review_document_job", { p_token: randomUUID() });
      if (error) throw error;
      const job = data?.[0] as ReviewJob | undefined;
      if (job) await run(job);
      else {
        if (Date.now() > cleanupAt) { await cleanupReviewJobs(); cleanupAt = Date.now() + 60000; }
        await sleep(3000);
      }
    } catch {
      console.error("[review-docs-worker] 연결 실패: Supabase 설정과 0094 마이그레이션을 확인해주세요.");
      await sleep(15000);
    }
  }
}
void startCheckedReviewWorker(process.argv.slice(2), {
  run: main,
  report: (result) => console.info("[review-docs-worker] 사전 점검 완료", result),
}).catch((error: unknown) => {
  console.error("[review-docs-worker] 시작 실패", safeReviewWorkerStartupError(error));
  process.exitCode = 1;
});
