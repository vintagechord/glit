import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getB2Config } from "@/lib/b2";
import { createAdminClient } from "@/lib/supabase/admin";
import { LABEL_GUIDE_KEY, RATING_LABELS, RATING_IMAGE_MAP, isRatingCode, resolveRatingImageSource } from "@/lib/mv-assets";
import { certificateSubmissionId, hasPublishedSubmissionResult } from "@/lib/submission-certificate";

export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export type EmailAttachmentRef = {
  kind: "rating-image" | "usage-guide" | "certificate";
  objectKey: string; filename: string; contentType: "image/png" | "image/jpeg" | "application/pdf";
  bytes: number; sha256: string; submissionId: string; rating: string; certificateKey: string;
};
export type ResolvedEmailAttachment = { filename: string; content: Buffer; contentType: string };
export type OnlineMvBundleState = { id?: string; type?: string | null; status?: string | null; result_status?: string | null; result_notified_at?: string | null; mv_desired_rating?: string | null; mv_rating?: string | null; certificate_b2_path?: string | null; certificate_original_name?: string | null };
export class EmailAttachmentError extends Error {
  constructor(readonly code: "attachment_invalid" | "attachment_unavailable" | "attachment_too_large" | "attachment_stale", message: string) { super(message); }
}
const invalid = () => new EmailAttachmentError("attachment_invalid", "심의 결과 첨부파일 정보를 확인해주세요.");
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const digest = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const safeFilename = (name: string) => name.normalize("NFC").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").slice(0, 180);

export function inspectOnlineMvBundleReadiness(submission: OnlineMvBundleState) {
  const rating = submission.mv_desired_rating || submission.mv_rating || "";
  const missing: string[] = [];
  if (submission.type !== "MV_DISTRIBUTION") missing.push("온라인 뮤직비디오 신청이 아닙니다.");
  if (!isRatingCode(rating)) missing.push("영등위 확정 등급을 먼저 저장해주세요.");
  if (!hasPublishedSubmissionResult(submission)) missing.push("심의 결과가 아직 공개되지 않았습니다.");
  if (rating !== "REJECT" && !submission.certificate_b2_path) missing.push("영등위가 발급한 필증을 업로드해주세요.");
  return { ready: missing.length === 0, missing, rating, rejected: rating === "REJECT", attachmentCount: rating === "REJECT" ? 0 : 3 };
}

export function validateEmailAttachmentRefs(value: unknown): value is EmailAttachmentRef[] {
  if (!Array.isArray(value) || value.length !== 3) return false;
  if (new Set(value.map(ref => ref?.kind)).size !== 3) return false;
  let total = 0;
  const first = value[0];
  for (const ref of value) {
    if (!ref || typeof ref !== "object" || !["rating-image", "usage-guide", "certificate"].includes(ref.kind) ||
      Object.keys(ref).length !== 9 || Object.keys(ref).some(key => !["kind", "objectKey", "filename", "contentType", "bytes", "sha256", "submissionId", "rating", "certificateKey"].includes(key)) ||
      typeof ref.objectKey !== "string" || !ref.objectKey || ref.objectKey.length > 1200 || /^https?:|^\//i.test(ref.objectKey) || /[\x00-\x1f\\]/.test(ref.objectKey) || ref.objectKey.split("/").some((part: string) => part === ".." || part === ".") ||
      typeof ref.filename !== "string" || !ref.filename || ref.filename !== safeFilename(ref.filename) || !["application/pdf", "image/png", "image/jpeg"].includes(ref.contentType) ||
      !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || !/^[a-f\d]{64}$/.test(ref.sha256) || !uuid.test(ref.submissionId) || !isRatingCode(ref.rating) || ref.rating === "REJECT" ||
      typeof ref.certificateKey !== "string" || !ref.certificateKey || ref.submissionId !== first.submissionId || ref.rating !== first.rating || ref.certificateKey !== first.certificateKey) return false;
    if (ref.kind === "usage-guide" && ref.contentType !== "application/pdf") return false;
    if (ref.kind === "rating-image" && !ref.contentType.startsWith("image/")) return false;
    if (ref.kind === "certificate" && ref.objectKey !== ref.certificateKey) return false;
    if (ref.kind !== "certificate" && !ref.objectKey.endsWith(`/email-attachments/${ref.submissionId}/${ref.sha256}.${ref.contentType === "application/pdf" ? "pdf" : ref.contentType === "image/png" ? "png" : "jpg"}`)) return false;
    total += ref.bytes;
  }
  return total <= MAX_EMAIL_ATTACHMENT_BYTES;
}
function detectMime(body: Buffer): EmailAttachmentRef["contentType"] | null {
  if (body.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255) return "image/jpeg";
  return null;
}
async function boundedBody(body: AsyncIterable<Uint8Array>, declaredSize?: number) {
  if (declaredSize && declaredSize > MAX_EMAIL_ATTACHMENT_BYTES) throw new EmailAttachmentError("attachment_too_large", "첨부파일 합계는 18MB까지 이메일로 보낼 수 있습니다. 필증 용량을 줄여 다시 업로드해주세요.");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of body) { size += chunk.length; if (size > MAX_EMAIL_ATTACHMENT_BYTES) throw new EmailAttachmentError("attachment_too_large", "첨부파일 합계는 18MB까지 이메일로 보낼 수 있습니다."); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function readB2(key: string) {
  const { client, bucket, prefix } = getB2Config();
  if ((!key.startsWith(prefix) && !certificateSubmissionId(key, prefix)) || key.split("/").some(part => part === ".." || part === ".")) throw invalid();
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(20_000) });
  if (!object.Body) throw invalid();
  return boundedBody(object.Body as AsyncIterable<Uint8Array>, object.ContentLength);
}
async function readSource(source: string) {
  if (source.startsWith("/")) {
    if (!/^\/media\/mv-ratings\/(?:all|12|15|19)\.png$/.test(source)) throw invalid();
    const bytes = await readFile(path.join(process.cwd(), "public", source.slice(1)));
    if (bytes.length > MAX_EMAIL_ATTACHMENT_BYTES) throw invalid();
    return bytes;
  }
  if (/^https?:\/\//.test(source)) {
    // Only server-configured first-party/static sources are read. HTTP sources
    // never survive into the persisted attachment reference or provider request.
    const url = new URL(source);
    const configured = new Set([LABEL_GUIDE_KEY, ...Object.values(RATING_IMAGE_MAP)]);
    const project = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sameStorage = project && url.origin === new URL(project).origin && url.pathname.startsWith("/storage/v1/object/public/");
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (!configured.has(source) && !sameStorage)) throw invalid();
    const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.body) throw new EmailAttachmentError("attachment_unavailable", "등급 이미지 또는 사용 예시 PDF를 읽지 못했습니다. 파일 설정을 확인해주세요.");
    return boundedBody(response.body as unknown as AsyncIterable<Uint8Array>, Number(response.headers.get("content-length")) || undefined);
  }
  return readB2(source);
}

/** Freeze exactly the same three assets offered by the account result page. */
export async function prepareOnlineMvAttachmentRefs(submission: OnlineMvBundleState, db: unknown): Promise<EmailAttachmentRef[]> {
  const readiness = inspectOnlineMvBundleReadiness(submission);
  if (!readiness.ready || readiness.rejected || !submission.id || !uuid.test(submission.id)) throw invalid();
  const { client, bucket, prefix } = getB2Config();
  const certificateKey = submission.certificate_b2_path!;
  if (certificateSubmissionId(certificateKey, prefix) !== submission.id) throw invalid();
  const rating = readiness.rating as Exclude<keyof typeof RATING_LABELS, "REJECT">;
  const image = await resolveRatingImageSource(rating, db);
  const sources = [
    { kind: "rating-image" as const, source: image.source, name: `관람등급_${RATING_LABELS[rating]}` },
    { kind: "usage-guide" as const, source: LABEL_GUIDE_KEY, name: "뮤직비디오_등급표시_사용예시" },
    { kind: "certificate" as const, source: certificateKey, name: submission.certificate_original_name?.replace(/\.[^.]+$/, "") || "영등위_심의필증" },
  ];
  const resolved: { source: typeof sources[number]; body: Buffer; mime: EmailAttachmentRef["contentType"]; hash: string }[] = [];
  let total = 0;
  try {
    for (const source of sources) {
      const body = await readSource(source.source); const mime = detectMime(body);
      if (!mime || source.kind === "rating-image" && !mime.startsWith("image/") || source.kind === "usage-guide" && mime !== "application/pdf") throw invalid();
      total += body.length; if (total > MAX_EMAIL_ATTACHMENT_BYTES) throw new EmailAttachmentError("attachment_too_large", "첨부 3개 파일의 합계가 18MB를 넘습니다. 필증 용량을 줄여 다시 업로드해주세요.");
      resolved.push({ source, body, mime, hash: digest(body) });
    }
    const refs: EmailAttachmentRef[] = [];
    for (const { source, body, mime, hash } of resolved) {
      const extension = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
      const objectKey = source.kind === "certificate" ? certificateKey : `${prefix}email-attachments/${submission.id}/${hash}${extension}`;
      if (source.kind !== "certificate") await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: mime, ContentLength: body.length }), { abortSignal: AbortSignal.timeout(20_000) });
      refs.push({ kind: source.kind, objectKey, filename: safeFilename(source.name + extension), contentType: mime, bytes: body.length, sha256: hash, submissionId: submission.id, rating, certificateKey });
    }
    return refs;
  } catch (error) {
    if (error instanceof EmailAttachmentError) throw error;
    throw new EmailAttachmentError("attachment_unavailable", "결과 첨부파일을 준비하지 못했습니다. 등급 이미지·사용 예시 PDF·필증을 확인하고 다시 알림을 보내주세요.");
  }
}

/** Called for every physical retry. An old result never sends newer/different files. */
export async function resolveEmailAttachments(refs: EmailAttachmentRef[]): Promise<ResolvedEmailAttachment[]> {
  if (!validateEmailAttachmentRefs(refs)) throw invalid();
  const { data, error } = await createAdminClient().from("submissions")
    .select("id,type,status,result_status,mv_desired_rating,mv_rating,certificate_b2_path")
    .eq("id", refs[0].submissionId).maybeSingle();
  if (error || !data) throw new EmailAttachmentError("attachment_unavailable", "결과 첨부파일의 신청 정보를 확인하지 못했습니다.");
  const current = inspectOnlineMvBundleReadiness(data);
  if (!current.ready || current.rating !== refs[0].rating || data.certificate_b2_path !== refs[0].certificateKey) throw new EmailAttachmentError("attachment_stale", "심의 결과가 변경되어 이전 첨부 메일의 발송을 중단했습니다. 최신 결과를 다시 안내해주세요.");
  try {
    const result = [];
    for (const ref of refs) {
      const content = await readB2(ref.objectKey);
      if (content.length !== ref.bytes || digest(content) !== ref.sha256 || detectMime(content) !== ref.contentType) throw invalid();
      result.push({ filename: ref.filename, content, contentType: ref.contentType });
    }
    return result;
  } catch (error) {
    if (error instanceof EmailAttachmentError) throw error;
    throw new EmailAttachmentError("attachment_unavailable", "결과 첨부파일을 내려받지 못했습니다.");
  }
}
