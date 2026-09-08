import { ZodError } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { readBoundedJsonBody } from "@/lib/request-body";

export class ArchiveError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_REQUEST") { super(message); }
}

export async function authorizeArchiveRequest(request: Request, mutation = false) {
  if (mutation) {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new ArchiveError("같은 사이트에서 다시 요청해주세요.", 403, "ORIGIN_MISMATCH");
    }
  }
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ArchiveError("로그인이 필요합니다.", 401, "AUTH_REQUIRED");
  const limit = consumeRateLimit({ namespace: mutation ? "music-archive-write" : "music-archive-read", identifier: user.id, limit: mutation ? 60 : 180, windowMs: 60_000 });
  if (!limit.allowed) throw new ArchiveError("요청이 많습니다. 잠시 후 다시 시도해주세요.", 429, "RATE_LIMITED");
  return { user, supabase };
}

export async function readArchiveJson(request: Request) {
  const body = await readBoundedJsonBody(request, 512_000);
  if (!body.ok) throw new ArchiveError(body.reason === "too_large" ? "입력 자료가 너무 큽니다." : "입력 형식을 확인해주세요.", body.reason === "too_large" ? 413 : 400);
  return body.value;
}

export const archiveJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });

export function archiveError(error: unknown) {
  if (error instanceof ZodError) return archiveJson({ error: "입력값과 대상 항목을 확인해주세요.", code: "VALIDATION_ERROR", issues: error.issues.slice(0, 12).map(i => ({ path: i.path.join("."), message: i.message })) }, 422);
  if (error instanceof ArchiveError) return archiveJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof Error && error.name === "ArchiveDomainError") return archiveJson({ error: error.message, code: "VALIDATION_ERROR" }, 422);
  return archiveJson({ error: "음악 관리 요청을 처리하지 못했습니다. 저장된 자료는 유지됩니다. 잠시 후 다시 시도해주세요.", code: "ARCHIVE_UNAVAILABLE" }, 503);
}

export function archiveDatabaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const message = error.message ?? "";
  if (error.code === "40001" || /VERSION|CONFLICT/.test(message)) throw new ArchiveError("다른 창이나 동기화에서 변경되었습니다. 새로고침한 뒤 다시 저장해주세요.", 409, "VERSION_CONFLICT");
  if (/NOT_FOUND|OWNER/.test(message)) throw new ArchiveError("항목을 찾을 수 없습니다.", 404, "NOT_FOUND");
  if (/LIMIT/.test(message)) throw new ArchiveError("관리 한도에 도달했습니다. 항목을 나누어 관리해주세요.", 429, "LIMIT_REACHED");
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202") throw new ArchiveError("음악 관리 DB 준비가 필요합니다. 관리자에게 문의해주세요.", 503, "MIGRATION_REQUIRED");
  if (error.code === "23505") throw new ArchiveError("이미 등록되었거나 진행 중인 항목입니다. 새로고침해주세요.", 409, "DUPLICATE");
  throw new ArchiveError("자료를 저장하거나 조회하지 못했습니다. 잠시 후 다시 시도해주세요.", 503, "DATABASE_ERROR");
}
