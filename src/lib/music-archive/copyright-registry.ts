import { z } from "zod";

// Server only. The API key must never be passed to a client component.
// Official specification: https://infuser.odcloud.kr/api/stages/27549/api-docs
const apiRoot = "https://api.odcloud.kr/api/CpyrRegInforService/v1/";
export const COPYRIGHT_REGISTRY_SOURCE_URL = "https://www.data.go.kr/data/15106731/openapi.do";
const field = z.string().trim().max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "검색어의 제어문자를 제거해주세요.").default("");
export const copyrightRegistryQuerySchema = z.object({
  title: field, writer: field, registrationNumber: field,
  page: z.number().int().min(1).max(100).default(1),
}).strict().refine(value => !!(value.title || value.writer || value.registrationNumber), "제목·저작자·등록번호 중 하나를 입력해주세요.");
export type CopyrightRegistryQuery = z.input<typeof copyrightRegistryQuerySchema>;

const registryMessages = {
  CONFIGURATION_REQUIRED: "저작권 등록정보 조회용 공공데이터 서비스키가 설정되지 않았습니다.",
  PERMISSION_REQUIRED: "공공데이터 서비스키 또는 저작권 등록정보 API의 활용 승인 상태를 확인해주세요.",
  RATE_LIMIT: "저작권 등록정보 조회 한도에 도달했습니다. 잠시 후 다시 확인해주세요.",
  TEMPORARY_ERROR: "저작권 등록정보 서비스에 일시적으로 연결하지 못했습니다. 다시 시도해주세요.",
  INVALID_RESPONSE: "저작권 등록정보 응답을 확인하지 못했습니다. 원본 등록정보를 직접 확인해주세요.",
} as const;
export class CopyrightRegistryError extends Error {
  constructor(public readonly code: keyof typeof registryMessages) {
    super(registryMessages[code]); this.name = "CopyrightRegistryError";
  }
}

export type CopyrightRegistrationCandidate = {
  provider: "copyright_commission";
  registrationNumber: string;
  title: string;
  authorName: string;
  registrationDate: string;
  workType?: string;
  officialUrl: string;
  checkedAt: string;
};
export type CopyrightRegistryResult = {
  status: "success" | "no_results";
  page: number;
  nextPage: number | null;
  matchCount: number;
  checkedAt: string;
  candidates: CopyrightRegistrationCandidate[];
};
type RegistryOptions = { apiKey?: string; fetchImpl?: typeof fetch; now?: () => Date };
const rowSchema = z.object({
  REG_ID: z.string().trim().min(1).max(200),
  CONT_TITLE: z.string().trim().min(1).max(1000),
  AUTHOR_NAME: z.string().max(4000).nullable().optional(),
  REG_DATE: z.string().max(100).nullable().optional(),
  CONT_CLASS_NAME: z.string().max(200).nullable().optional(),
});
const envelopeSchema = z.object({
  page: z.number().int().min(1), perPage: z.number().int().min(1).max(10),
  currentCount: z.number().int().min(0).max(10), matchCount: z.number().int().min(0),
  data: z.array(rowSchema).max(10),
});

export function isCopyrightRegistryConfigured(env: Record<string, string | undefined> = process.env) {
  return !!env.COPYRIGHT_REGISTRY_API_KEY?.trim();
}

async function requestRegistry(operation: "getCpyrRegInforUniList" | "getCpyrRegInforUniDetail", parameters: URLSearchParams, options: RegistryOptions): Promise<z.infer<typeof envelopeSchema>> {
  const key = (options.apiKey ?? process.env.COPYRIGHT_REGISTRY_API_KEY)?.trim();
  if (!key) throw new CopyrightRegistryError("CONFIGURATION_REQUIRED");
  const url = new URL(operation, apiRoot);
  parameters.set("serviceKey", key);
  parameters.set("returnType", "JSON");
  url.search = parameters.toString();
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new CopyrightRegistryError("PERMISSION_REQUIRED");
      if (response.status === 429) throw new CopyrightRegistryError("RATE_LIMIT");
      throw new CopyrightRegistryError("TEMPORARY_ERROR");
    }
    if (Number(response.headers.get("content-length")) > 1024 * 1024) {
      await response.body?.cancel(); throw new CopyrightRegistryError("INVALID_RESPONSE");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new CopyrightRegistryError("INVALID_RESPONSE");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024 * 1024) { await reader.cancel(); throw new CopyrightRegistryError("INVALID_RESPONSE"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new CopyrightRegistryError("INVALID_RESPONSE"); }
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success || parsed.data.currentCount !== parsed.data.data.length || parsed.data.data.length > parsed.data.perPage) throw new CopyrightRegistryError("INVALID_RESPONSE");
    return parsed.data;
  } catch (error) {
    // Raw request errors can include the URL containing serviceKey. Never expose them.
    if (error instanceof CopyrightRegistryError) throw error;
    throw new CopyrightRegistryError("TEMPORARY_ERROR");
  }
}

function candidate(row: z.infer<typeof rowSchema>, checkedAt: string): CopyrightRegistrationCandidate {
  return {
    provider: "copyright_commission", registrationNumber: row.REG_ID, title: row.CONT_TITLE,
    authorName: row.AUTHOR_NAME?.trim() ?? "", registrationDate: row.REG_DATE?.trim() ?? "",
    ...(row.CONT_CLASS_NAME?.trim() ? { workType: row.CONT_CLASS_NAME.trim() } : {}),
    officialUrl: COPYRIGHT_REGISTRY_SOURCE_URL, checkedAt,
  };
}

/** One requested page, with no background pagination or per-result detail requests. */
export async function searchCopyrightRegistrations(input: CopyrightRegistryQuery, options: RegistryOptions = {}): Promise<CopyrightRegistryResult> {
  const query = copyrightRegistryQuerySchema.parse(input);
  const parameters = new URLSearchParams({ page: String(query.page), perPage: "10" });
  if (query.title) parameters.set("cond[CONT_TITLE::LIKE]", query.title);
  if (query.writer) parameters.set("cond[AUTHOR_NAME::LIKE]", query.writer);
  if (query.registrationNumber) parameters.set("cond[REG_ID::EQ]", query.registrationNumber);
  const response = await requestRegistry("getCpyrRegInforUniList", parameters, options);
  if (response.page !== query.page || response.perPage !== 10) throw new CopyrightRegistryError("INVALID_RESPONSE");
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  return {
    status: response.data.length ? "success" : "no_results", page: response.page,
    nextPage: response.page < 100 && response.page * response.perPage < response.matchCount ? response.page + 1 : null,
    matchCount: response.matchCount, checkedAt, candidates: response.data.map(row => candidate(row, checkedAt)),
  };
}

/** Explicit selection can check the work classification; do not assume every title is music. */
export async function getCopyrightRegistrationDetail(registrationNumber: string, options: RegistryOptions = {}): Promise<CopyrightRegistrationCandidate | null> {
  const value = field.refine(text => !!text, "등록번호를 입력해주세요.").parse(registrationNumber);
  const parameters = new URLSearchParams({ page: "1", perPage: "10", "cond[REG_ID::EQ]": value });
  const response = await requestRegistry("getCpyrRegInforUniDetail", parameters, options);
  if (response.data.some(row => row.REG_ID !== value) || response.data.length > 1) throw new CopyrightRegistryError("INVALID_RESPONSE");
  return response.data[0] ? candidate(response.data[0], (options.now ?? (() => new Date()))().toISOString()) : null;
}
