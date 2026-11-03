import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadKind } from "@/lib/upload-file-types";

/**
 * A single PUT (or the small server-streamed fallback) is bound to the file
 * metadata the server approved before any byte was sent. Completion reads
 * this row instead of trusting the browser a second time, and an upload that
 * is never completed leaves a PENDING row the scheduled cleanup removes
 * together with its object.
 */
export const UPLOAD_PUT_GRANT_TTL_SECONDS = 24 * 60 * 60;

export type UploadPutGrant = {
  id: string;
  submission_id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  upload_kind: UploadKind;
  declared_size_bytes: number;
  status: "PENDING" | "COMPLETED";
  expires_at: string;
};

export async function createUploadPutGrant(params: {
  submissionId: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  uploadKind: UploadKind;
  declaredSizeBytes: number;
}) {
  const { data, error } = await createAdminClient()
    .from("upload_put_grants")
    .insert({
      submission_id: params.submissionId,
      object_key: params.objectKey,
      original_name: params.originalName,
      mime_type: params.mimeType,
      upload_kind: params.uploadKind,
      declared_size_bytes: params.declaredSizeBytes,
      status: "PENDING",
      expires_at: new Date(Date.now() + UPLOAD_PUT_GRANT_TTL_SECONDS * 1_000).toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "업로드 권한을 저장할 수 없습니다.");
  }
  return data as UploadPutGrant;
}

export async function getUploadPutGrant(submissionId: string, objectKey: string) {
  const { data, error } = await createAdminClient()
    .from("upload_put_grants")
    .select("*")
    .eq("submission_id", submissionId)
    .eq("object_key", objectKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as UploadPutGrant | null) ?? null;
}

/** Best effort: a PENDING row whose staging receipt exists keeps its object. */
export async function markUploadPutGrantCompleted(grantId: string) {
  const completedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("upload_put_grants")
    .update({ status: "COMPLETED", consumed_at: completedAt })
    .eq("id", grantId)
    .eq("status", "PENDING");
  if (error) throw new Error(error.message);
}
