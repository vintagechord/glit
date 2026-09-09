import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReviewDocuments } from "@/lib/admin/review-docs";
import { extractFiles } from "./extract";
import { extractUrls } from "./urls";
import { translateReviewData } from "./translation";
import { validateReviewData, type ReviewDocumentData } from "./model";
import { getReviewRetrySourceIds, mergeRetryExtraction } from "./retry";
import { jobDatabaseError } from "./jobs";
import { REVIEW_JOB_LIMITS, ReviewJobError, type ReviewJob, type ReviewJobOutput } from "./jobs-types";
import { assertPrivateReviewBucket, assertReviewObjectKey, deleteReviewObject, getReviewObject, putReviewObject, reviewObjectKey } from "./storage";

async function updateClaim(job: ReviewJob, update: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { data, error } = await createAdminClient().from("review_document_jobs").update({ ...update, updated_at: new Date().toISOString() }).eq("id", job.id).eq("lease_token", job.lease_token!).eq("version", job.version).gt("lease_until", new Date().toISOString()).select("id").abortSignal(signal ?? AbortSignal.timeout(20_000)).maybeSingle();
  jobDatabaseError(error);
  if (!data) throw new ReviewJobError("작업이 취소되었거나 실행 권한이 만료되었습니다.", 409, "LEASE_LOST");
}
function remapUrlSources(data: ReviewDocumentData, job: ReviewJob) {
  const ids = new Map(data.sources.map((source) => [source.id, job.sources.find((s) => s.url === source.url)?.id ?? source.id]));
  const evidence = (entries: typeof data.albums[number]["evidence"]) => entries.map((e) => ({ ...e, sourceId: ids.get(e.sourceId) ?? e.sourceId }));
  return { ...data, sources: data.sources.map((s) => ({ ...s, id: ids.get(s.id)! })), issues: data.issues.map((i) => ({ ...i, sourceId: i.sourceId ? ids.get(i.sourceId) ?? i.sourceId : undefined })), albums: data.albums.map((a) => ({ ...a, sourceIds: a.sourceIds.map((id) => ids.get(id) ?? id), evidence: evidence(a.evidence), tracks: a.tracks.map((t) => ({ ...t, sourceIds: t.sourceIds.map((id) => ids.get(id) ?? id), evidence: evidence(t.evidence) })) })) };
}
async function persistOutput(job: ReviewJob, name: string, buffer: Buffer, type: string, signal?: AbortSignal): Promise<ReviewJobOutput> {
  signal?.throwIfAborted();
  if (buffer.length > 64 * 1024 * 1024) throw new ReviewJobError("생성 파일이 64MB를 초과합니다. 앨범을 나누어 생성해주세요.", 422, "OUTPUT_LIMIT");
  const id = randomUUID(); const objectKey = reviewObjectKey(job.created_by, job.id, id);
  // Record the object before upload: failures and superseded versions remain eligible for cleanup.
  const { error } = await createAdminClient().from("review_document_artifacts").insert({ id, job_id: job.id, object_key: objectKey }).abortSignal(signal ?? AbortSignal.timeout(20_000));
  jobDatabaseError(error);
  signal?.throwIfAborted();
  const digest = await putReviewObject(objectKey, buffer, type, signal);
  return { id, name, objectKey, ...digest };
}
export async function processReviewJob(job: ReviewJob, signal?: AbortSignal) {
  try {
    signal?.throwIfAborted();
    await assertPrivateReviewBucket(undefined, signal);
    signal?.throwIfAborted();
    if (job.operation === "generate") {
      if (!job.snapshot_data) throw new ReviewJobError("확정 데이터가 없습니다.", 422, "SNAPSHOT_MISSING");
      const errors = validateReviewData(job.snapshot_data).filter((i) => i.severity === "error");
      if (errors.length) throw new ReviewJobError("확인이 필요한 항목이 남아 있습니다. 수정본을 저장 후 생성해주세요.", 422, "REVIEW_REQUIRED");
      const generated = await generateReviewDocuments(job.snapshot_data);
      await updateClaim(job, { status: "validating" }, signal);
      // Generation verifies DOCX/ZIP structure. Rendering is reported separately, never implied.
      const outputs: ReviewJobOutput[] = [];
      for (const file of generated.files) {
        await updateClaim(job, { status: "validating" }, signal);
        outputs.push(await persistOutput(job, file.name, file.buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signal));
      }
      const zip = await persistOutput(job, job.mode === "mv" ? "영등위_가사.zip" : "음반_심의자료.zip", generated.zip, "application/zip", signal);
      await updateClaim(job, { outputs, zip_output: zip, result_version: job.version, template_version: generated.templateVersion,
        counts: { albumCount: generated.albumCount, trackCount: generated.trackCount, docxCount: generated.docxCount }, validation: generated.validation,
        status: "completed", error_code: null, error_message: null, retryable: false, lease_token: null, lease_until: null }, signal);
    } else {
      const reextract = job.operation === "reextract";
      let extracted = reextract ? null : job.operation === "translate" ? job.snapshot_data : job.extracted_data;
      const retryIds = reextract && job.snapshot_data ? getReviewRetrySourceIds(job.snapshot_data, job.sources) : [];
      const inputSources = reextract ? job.sources.filter((source) => retryIds.includes(source.id)) : job.sources;
      if (reextract && (!job.snapshot_data || !inputSources.length)) throw new ReviewJobError("다시 분석할 원본이 없습니다.", 422, "RETRY_SOURCE_MISSING");
      if (!extracted) {
        if (job.input_kind === "urls") extracted = remapUrlSources(await extractUrls(inputSources.map((s) => s.url!), job.application_date, { signal }), job);
        else {
          const files = [];
          for (const source of inputSources) {
            if (!source.objectKey) throw new ReviewJobError("원본 파일이 없습니다. 다시 업로드해주세요.", 422, "SOURCE_MISSING");
            assertReviewObjectKey(source.objectKey, job.created_by, job.id);
            const buffer = await getReviewObject(source.objectKey, REVIEW_JOB_LIMITS.fileBytes, signal);
            if (createHash("sha256").update(buffer).digest("hex") !== source.sha256) throw new ReviewJobError("원본 파일 무결성 확인에 실패했습니다. 다시 업로드해주세요.", 422, "SOURCE_INTEGRITY");
            files.push({ id: source.id, name: source.name, mime: source.mime ?? "application/octet-stream", buffer });
          }
          extracted = await extractFiles(files, job.mode, job.application_date);
        }
        if (!reextract) await updateClaim(job, { extracted_data: extracted }, signal);
      }
      if (reextract) extracted = mergeRetryExtraction(job.snapshot_data!, extracted);
      await updateClaim(job, { status: "translating" }, signal);
      const translated = await translateReviewData(extracted, { signal });
      await updateClaim(job, { draft_data: translated, version: job.operation === "translate" || reextract ? job.version + 1 : job.version, status: "needs_review", error_code: null, error_message: null, retryable: false, lease_token: null, lease_until: null }, signal);
    }
  } catch (error) {
    if (signal?.aborted) return; // The web supervisor owns cancellation/timeout recovery.
    await failReviewJob(job, error);
  }
}
export async function failReviewJob(job: ReviewJob, error: unknown) {
  if (error instanceof ReviewJobError && error.code === "LEASE_LOST") return;
  const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const temporary = error instanceof ReviewJobError ? error.retryable : /ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR/.test(rawCode) || (error instanceof Error && /timeout|fetch failed/i.test(error.message));
  const remaining = job.attempts < 3 && (!["extract", "reextract"].includes(job.operation) || job.extraction_attempts < 3);
  const retry = temporary && remaining;
  // Extractor/template errors are safe domain messages; raw service errors are never exposed.
  const safeError = error instanceof ReviewJobError || (error instanceof Error && /^(Review|Extraction)/.test(error.name));
  const code = error instanceof ReviewJobError ? error.code : rawCode && /^[A-Z_]{1,80}$/.test(rawCode) ? rawCode : "PROCESSING_FAILED";
  const message = safeError && error instanceof Error ? error.message.slice(0, 2000) : "문서 처리에 실패했습니다. 파일 형식·변환기·템플릿과 서버 연결을 확인해주세요.";
  const { error: updateError } = await createAdminClient().from("review_document_jobs").update({
    status: retry ? "queued" : "failed", retryable: temporary && remaining,
    error_code: code, error_message: message, lease_token: null, lease_until: null,
    available_at: new Date(Date.now() + job.attempts * 15000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("lease_token", job.lease_token!).abortSignal(AbortSignal.timeout(10_000));
  jobDatabaseError(updateError);
  console.info("[review-docs] job ended", { jobId: job.id, mode: job.mode, version: job.version, code, retry });
}

export async function cleanupReviewJobs() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("review_document_jobs").select("id,created_by,sources").lt("expires_at", new Date().toISOString()).is("lease_token", null).is("purged_at", null).limit(10);
  jobDatabaseError(error);
  for (const job of data ?? []) {
    const { data: artifacts, error: artifactError } = await admin.from("review_document_artifacts").select("id,object_key").eq("job_id", job.id);
    jobDatabaseError(artifactError);
    const keys = [...(job.sources as ReviewJob["sources"]).flatMap((s) => s.objectKey ? [s.objectKey] : []), ...(artifacts ?? []).map((a) => a.object_key as string)];
    // Do not expire/purge metadata until each dedicated object is successfully deleted.
    for (const key of keys) await deleteReviewObject(key, job.created_by, job.id);
    const { error: artifactDeleteError } = await admin.from("review_document_artifacts").delete().eq("job_id", job.id);
    jobDatabaseError(artifactDeleteError);
    const { error: jobError } = await admin.from("review_document_jobs").update({ status: "expired", sources: [], outputs: [], zip_output: null, extracted_data: null, draft_data: null, snapshot_data: null, purged_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    jobDatabaseError(jobError);
  }
  const { error: historyError } = await admin.from("review_document_jobs").delete().not("purged_at", "is", null).lt("created_at", new Date(Date.now() - 90 * 86400000).toISOString());
  jobDatabaseError(historyError);
}
