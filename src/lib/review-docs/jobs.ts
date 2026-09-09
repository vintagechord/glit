import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewDocumentDataSchema, validateReviewData } from "./model";
import { canonicalReviewUrls } from "./urls";
import { validateReviewUpload } from "./upload-validation";
import { getReviewRetrySourceIds } from "./retry";
import { recordManualReviewEdits } from "./manual-edits";
import { REVIEW_JOB_LIMITS, ReviewJobError, type ReviewJob, type ReviewJobSource } from "./jobs-types";
import { assertPrivateReviewBucket, deleteReviewObject, putReviewObject, reviewObjectKey } from "./storage";
import { assertReviewFormats, reviewProcessor } from "./web-runtime";

export function jobDatabaseError(error: { message?: string; code?: string } | null) {
  if (!error) return;
  const message = error.message ?? "";
  if (message.includes("REVIEW_JOB_NOT_FOUND")) throw new ReviewJobError("작업을 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
  if (message.includes("REVIEW_JOB_EXPIRED")) throw new ReviewJobError("보존기간이 만료된 작업입니다. 새로 업로드해주세요.", 410, "JOB_EXPIRED");
  if (message.includes("REVIEW_JOB_LIMIT")) throw new ReviewJobError("진행 중인 작업이 3개입니다. 완료 후 다시 시도해주세요.", 429, "JOB_LIMIT");
  if (message.includes("REVIEW_TRANSLATION_LIMIT")) throw new ReviewJobError("이 작업의 추가 번역 요청 한도(3회)를 사용했습니다. 원문을 확인해 번역을 직접 입력해주세요.", 422, "TRANSLATION_LIMIT");
  if (message.includes("CONFLICT")) throw new ReviewJobError("다른 화면에서 수정했거나 이미 처리 중입니다. 작업을 새로 열어주세요.", 409, "VERSION_CONFLICT");
  if (error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST205") throw new ReviewJobError("심의자료 작업 테이블이 준비되지 않았습니다. 추가 마이그레이션 0094를 먼저 검증·적용해주세요.", 503, "MIGRATION_REQUIRED");
  throw new ReviewJobError("작업 저장소에 연결할 수 없습니다. Supabase 설정을 확인한 뒤 다시 시도해주세요.", 503, "DATABASE_UNAVAILABLE", true);
}
export async function loadReviewJob(id: string, owner: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ReviewJobError("작업을 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
  const { data, error } = await createAdminClient().from("review_document_jobs").select("*").eq("id", id).eq("created_by", owner).maybeSingle();
  jobDatabaseError(error);
  if (!data) throw new ReviewJobError("작업을 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
  return data as ReviewJob;
}
export function assertJobLive(job: ReviewJob) {
  if (job.status === "expired" || Date.parse(job.expires_at) <= Date.now()) throw new ReviewJobError("보존기간이 만료되었습니다. 새 작업으로 업로드해주세요.", 410, "JOB_EXPIRED");
}
function hasRecentWorkerHeartbeat(heartbeat: { updated_at: string } | null) {
  return !!heartbeat && Date.parse(heartbeat.updated_at) > Date.now() - 90_000;
}
export async function listReviewJobs(owner: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("review_document_jobs").select("id,mode,input_kind,status,operation,version,result_version,sources,outputs,zip_output,counts,validation,template_version,error_code,error_message,retryable,attempts,extraction_attempts,application_date,created_at,updated_at,expires_at").eq("created_by", owner).order("created_at", { ascending: false }).limit(20);
  jobDatabaseError(error);
  const { data: heartbeat, error: heartbeatError } = await admin.from("review_document_worker_heartbeat").select("updated_at").eq("singleton", true).maybeSingle();
  jobDatabaseError(heartbeatError);
  return { jobs: data as ReviewJob[], ...await reviewProcessor(hasRecentWorkerHeartbeat(heartbeat)) };
}
async function requireReviewWorker(names: string[] = []) {
  const { data, error } = await createAdminClient().from("review_document_worker_heartbeat").select("updated_at").eq("singleton", true).maybeSingle();
  jobDatabaseError(error);
  assertReviewFormats(await reviewProcessor(hasRecentWorkerHeartbeat(data)), names);
}
async function createJob(owner: string, mode: "album" | "mv", kind: "files" | "urls", sources: ReviewJobSource[], fingerprint: string, id: string) {
  const { data, error } = await createAdminClient().rpc("create_review_document_job", { p_id: id, p_owner: owner, p_mode: mode, p_kind: kind, p_sources: sources, p_fingerprint: fingerprint });
  jobDatabaseError(error); return data as ReviewJob;
}
export async function createFileReviewJob(owner: string, mode: "album" | "mv", files: { name: string; mime: string; buffer: Buffer }[]) {
  await requireReviewWorker(files.map((file) => file.name));
  const id = randomUUID();
  const sources: ReviewJobSource[] = [];
  for (const file of files) {
    await validateReviewUpload(file);
    const fileId = randomUUID();
    sources.push({ id: fileId, name: file.name, mime: file.mime, size: file.buffer.length, sha256: createHash("sha256").update(file.buffer).digest("hex"), objectKey: reviewObjectKey(owner, id, fileId) });
  }
  const hashes = sources.map((source) => source.sha256!).sort();
  if (new Set(hashes).size !== hashes.length) throw new ReviewJobError("동일한 내용의 파일이 중복되었습니다. 하나만 업로드해주세요.", 409, "DUPLICATE_SOURCE");
  const fingerprint = createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
  await assertPrivateReviewBucket();
  const job = await createJob(owner, mode, "files", sources, fingerprint, id);
  if (job.id !== id) return { job, duplicate: true };
  try {
    for (let index = 0; index < files.length; index++) {
      await putReviewObject(sources[index].objectKey!, files[index].buffer, files[index].mime);
    }
    const { data, error } = await createAdminClient().from("review_document_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "uploading").select("*").maybeSingle();
    jobDatabaseError(error);
    if (!data) throw new ReviewJobError("업로드가 취소되었습니다. 작업 이력을 확인해주세요.", 409, "UPLOAD_CANCELLED");
    return { job: data as ReviewJob, duplicate: false };
  } catch (error) {
    await Promise.allSettled(sources.map((source) => deleteReviewObject(source.objectKey!, owner, id)));
    await createAdminClient().from("review_document_jobs").update({ status: "failed", error_code: "UPLOAD_FAILED", error_message: "업로드에 실패했습니다. 새 작업으로 파일을 다시 업로드해주세요.", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "uploading");
    throw error;
  }
}
export async function createUrlReviewJob(owner: string, input: unknown) {
  const raw = input as { urls?: unknown; mode?: unknown };
  if (!raw || raw.mode !== "album" || !Array.isArray(raw.urls) || !raw.urls.length || raw.urls.length > REVIEW_JOB_LIMITS.urls || raw.urls.some((url) => typeof url !== "string" || url.length > 2000)) throw new ReviewJobError("멜론·지니 앨범 URL을 1~8개 입력해주세요.");
  const { urls, duplicates } = canonicalReviewUrls(raw.urls as string[]);
  if (duplicates.length) throw new ReviewJobError(`동일한 앨범 URL이 ${duplicates.length}개 중복되었습니다. 중복 URL을 제거해주세요.`, 409, "DUPLICATE_URL");
  await requireReviewWorker(); await assertPrivateReviewBucket();
  const id = randomUUID();
  const sources = urls.map((url) => ({ id: randomUUID(), name: url, url }));
  const fingerprint = createHash("sha256").update(JSON.stringify([...urls].sort())).digest("hex");
  const job = await createJob(owner, "album", "urls", sources, fingerprint, id);
  return { job, duplicate: job.id !== id };
}
export async function changeReviewJob(job: ReviewJob, owner: string, action: string, version: unknown, input?: unknown) {
  assertJobLive(job);
  if (!Number.isSafeInteger(version) || version !== job.version) throw new ReviewJobError("수정 버전이 변경되었습니다. 작업을 새로 열어주세요.", 409, "VERSION_CONFLICT");
  let draft = null;
  if (action === "save") {
    const parsed = reviewDocumentDataSchema.safeParse(input);
    if (!parsed.success) throw new ReviewJobError("앨범·트랙 정보의 형식이나 허용 길이를 확인해주세요.", 422, "DATA_INVALID");
    const base = job.draft_data ?? job.extracted_data;
    if (!base) throw new ReviewJobError("먼저 파일 분석을 완료해주세요.", 409, "EXTRACTION_REQUIRED");
    // Client edits cannot replace original evidence, mode, date or erase unresolved extraction issues.
    const issueIds = new Set(base.issues.map((issue) => issue.id));
    draft = { ...parsed.data, mode: job.mode, applicationDate: job.application_date, sources: base.sources,
      issues: [...base.issues, ...parsed.data.issues.filter((issue) => !issueIds.has(issue.id))] };
    draft = recordManualReviewEdits(draft, base);
    if (draft.albums.length > REVIEW_JOB_LIMITS.albums || draft.albums.reduce((n, a) => n + a.tracks.length, 0) > REVIEW_JOB_LIMITS.tracks) throw new ReviewJobError("최대 8개 앨범·전체 100곡까지 저장할 수 있습니다.");
  }
  if (action === "generate") {
    const data = job.draft_data ?? job.extracted_data;
    if (!data) throw new ReviewJobError("분석 결과가 없습니다.", 409, "EXTRACTION_REQUIRED");
    const errors = validateReviewData(data).filter((issue) => issue.severity === "error");
    if (errors.length) throw new ReviewJobError(`확인 또는 보완이 필요한 항목 ${errors.length}개가 있습니다. ${errors[0].message}`, 422, "REVIEW_REQUIRED");
  }
  if (action === "retry" && job.status === "needs_review") {
    const current = job.draft_data ?? job.extracted_data;
    if (!current || !getReviewRetrySourceIds(current, job.sources).length || job.extraction_attempts >= 3) throw new ReviewJobError("다시 분석할 실패 원본이 없거나 분석 한도 3회를 사용했습니다. 원문을 확인해 수동 보완해주세요.", 422, "RETRY_LIMIT");
  }
  if (["generate", "translate", "retry"].includes(action)) await requireReviewWorker(action === "retry" && job.input_kind === "files" && (job.status === "needs_review" || ["extract", "reextract"].includes(job.operation)) ? job.sources.map((source) => source.name) : []);
  const { data, error } = await createAdminClient().rpc("change_review_document_job", { p_id: job.id, p_owner: owner, p_version: version, p_action: action, p_data: draft });
  jobDatabaseError(error); return data as ReviewJob;
}
