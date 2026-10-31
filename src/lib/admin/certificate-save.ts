import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getB2Config, sanitizeFileName } from "@/lib/b2";
import { reviewManagementError } from "@/lib/admin/review-management";
import { SERVER_UPLOAD_MAX_BYTES, SERVER_UPLOAD_MAX_LABEL } from "@/lib/server-upload-limit";

export const MAX_CERTIFICATE_BYTES = SERVER_UPLOAD_MAX_BYTES;
export type ManagedCertificateSaveResult =
  | { ok: true; changed: boolean; certificate: { objectKey: string; originalName: string | null; uploadedAt: string | null } }
  | { ok: false; error: string; status: number };
export function detectCertificateMimeType(body: Buffer) {
  if (body.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  return null;
}
export async function saveManagedCertificate(db: SupabaseClient, input: {
  actorUserId: string; submissionId: string; expectedUpdatedAt: string;
  body: Buffer; filename: string; requestId?: string; declaredMime?: string;
}): Promise<ManagedCertificateSaveResult> {
  const mime = detectCertificateMimeType(input.body);
  const name = input.filename.normalize("NFC").replace(/[\x00-\x1f\x7f/\\]/g, "_").trim();
  if (!mime || !input.body.length || input.body.length > MAX_CERTIFICATE_BYTES || !name || name.length > 255 || (input.declaredMime && input.declaredMime !== mime)) return { ok: false, error: `필증은 실제 내용이 일치하는 PDF·PNG·JPG 파일(${SERVER_UPLOAD_MAX_LABEL} 이하)이어야 합니다.`, status: 400 };
  const { data: submission, error } = await db.from("submissions").select("id,type,updated_at,certificate_b2_path,certificate_original_name,certificate_uploaded_at").eq("id", input.submissionId).maybeSingle();
  if (error || !submission) return { ok: false, error: "접수를 찾을 수 없습니다.", status: 404 };
  if (submission.type !== "MV_DISTRIBUTION") return { ok: false, error: "온라인 MV에만 영등위 필증을 등록할 수 있습니다.", status: 400 };
  const { client, bucket, prefix } = getB2Config();
  const requestId = input.requestId && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.requestId) ? input.requestId : randomUUID();
  const safe = `${createHash("sha256").update(input.body).digest("hex").slice(0, 16)}_${sanitizeFileName(name) || "certificate"}`.slice(0, 120);
  const objectKey = `${prefix}${input.submissionId}/certificate/${requestId}_${safe}`;
  if (submission.certificate_b2_path === objectKey) return { ok: true, changed: false, certificate: { objectKey, originalName: submission.certificate_original_name, uploadedAt: submission.certificate_uploaded_at } };
  if (!input.expectedUpdatedAt || submission.updated_at !== input.expectedUpdatedAt) return { ok: false, error: "다른 화면에서 접수가 변경되었습니다. 최신 내용을 다시 불러온 뒤 업로드해주세요.", status: 409 };
  const uploadedAt = new Date().toISOString();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: input.body, ContentType: mime, ContentLength: input.body.length }));
  const recorded = await db.rpc("record_managed_submission_certificate", {
    p_submission_id: input.submissionId, p_actor_user_id: input.actorUserId,
    p_expected_updated_at: input.expectedUpdatedAt, p_object_key: objectKey,
    p_original_name: name, p_mime_type: mime, p_size_bytes: input.body.length, p_uploaded_at: uploadedAt,
  });
  if (recorded.error || !recorded.data?.completed) {
    // A lost response may follow a committed record. Preserve every uploaded
    // object, including previous certificates, until the operator reconciles it.
    const result = reviewManagementError(recorded.error);
    return { ok: false, error: result.error ?? "필증 정보를 저장하지 못했습니다.", status: result.errorCode === "CONFLICT" ? 409 : 500 };
  }
  return { ok: true, changed: recorded.data.changed !== false, certificate: { objectKey, originalName: name, uploadedAt: recorded.data.uploadedAt || uploadedAt } };
}
