import Busboy from "busboy";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/admin/api-auth";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { ReviewJobError, REVIEW_JOB_LIMITS } from "./jobs-types";
import { ReviewExtractionError } from "./upload-validation";

export async function authorizeReviewRequest(request: Request, mutation = false) {
  const auth = await requireAdminForApi();
  if (!auth.ok) throw new ReviewJobError(auth.error, auth.status, "AUTH_REQUIRED");
  if (mutation) {
    const origin = request.headers.get("origin");
    const expected = new URL(request.url).origin;
    const configured = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL]
      .flatMap((value) => { try { return value ? [new URL(value).origin] : []; } catch { return []; } });
    if (!origin || (origin !== expected && !configured.includes(origin)) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new ReviewJobError("같은 사이트의 관리자 화면에서 다시 요청해주세요.", 403, "ORIGIN_REJECTED");
    }
    const rate = consumeRateLimit({ namespace: "review-docs", identifier: auth.user.id, limit: 30, windowMs: 60000 });
    if (!rate.allowed) throw new ReviewJobError("요청이 많습니다. 1분 후 다시 시도해주세요.", 429, "RATE_LIMIT");
  }
  return auth.user;
}
export function reviewJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function reviewError(error: unknown) {
  if (error instanceof ReviewJobError) return reviewJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof ReviewExtractionError) return reviewJson({ error: error.message, code: error.code }, 422);
  // Never log untrusted documents, lyrics, keys, or signed URLs.
  console.error("[review-docs] request failed", { code: "REQUEST_FAILED" });
  return reviewJson({ error: "심의자료 서버 연결에 실패했습니다. 연결 설정과 작업 테이블 설치 상태를 확인한 뒤 다시 시도해주세요.", code: "REQUEST_FAILED" }, 503);
}
export async function readReviewJson(request: Request, maxBytes = 2 * 1024 * 1024) {
  if (!request.body) throw new ReviewJobError("요청 본문이 없습니다.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new ReviewJobError("요청 데이터가 너무 큽니다.", 413, "BODY_TOO_LARGE"); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ReviewJobError("올바른 JSON 요청이 필요합니다."); }
  } finally { reader.releaseLock(); }
}
export async function readReviewUpload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data") || !request.body) throw new ReviewJobError("업로드할 파일을 선택해주세요.");
  const files: { name: string; mime: string; buffer: Buffer }[] = [];
  const fields: Record<string, string> = {};
  const parser = Busboy({ headers: { "content-type": contentType }, defParamCharset: "utf8", limits: { files: REVIEW_JOB_LIMITS.files, fileSize: REVIEW_JOB_LIMITS.fileBytes, fields: 2, fieldSize: 100, parts: 10 } });
  let failure: Error | null = null;
  const fail = () => { failure = new ReviewJobError("파일 수·크기 제한을 초과했습니다. 파일 8개, 개별 10MB, 전체 40MB까지 가능합니다.", 413, "UPLOAD_LIMIT"); };
  parser.on("file", (field, stream, info) => {
    const chunks: Buffer[] = [];
    if (field !== "files") failure = new ReviewJobError("잘못된 업로드 항목입니다.");
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", () => { failure = new ReviewJobError("업로드된 파일 전송이 중단되었습니다. 다시 업로드해주세요.", 400, "UPLOAD_INTERRUPTED"); });
    stream.on("limit", fail);
    stream.on("end", () => files.push({ name: info.filename, mime: info.mimeType, buffer: Buffer.concat(chunks) }));
  });
  parser.on("field", (name, value, info) => { if (info.valueTruncated || name !== "mode") failure = new ReviewJobError("잘못된 업로드 정보입니다."); fields[name] = value; });
  parser.on("filesLimit", fail); parser.on("fieldsLimit", fail); parser.on("partsLimit", fail);
  const finished = new Promise<void>((resolve, reject) => { parser.on("close", resolve); parser.on("error", reject); });
  // Attach a handler immediately so early malformed multipart errors are handled.
  void finished.catch(() => {});
  const reader = request.body.getReader(); let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > REVIEW_JOB_LIMITS.totalBytes + 65536 || failure) { await reader.cancel(); fail(); break; }
      parser.write(Buffer.from(value));
    }
    parser.end(); await finished;
  } catch { throw failure ?? new ReviewJobError("손상된 업로드 요청입니다."); }
  finally { reader.releaseLock(); }
  if (failure) throw failure;
  if (!files.length || files.reduce((n, f) => n + f.buffer.length, 0) > REVIEW_JOB_LIMITS.totalBytes) throw new ReviewJobError("파일을 1개 이상 선택하고 전체 40MB 이내로 업로드해주세요.");
  if (fields.mode !== "album" && fields.mode !== "mv") throw new ReviewJobError("음반 또는 영등위 모드를 선택해주세요.");
  return { files, mode: fields.mode as "album" | "mv" };
}
