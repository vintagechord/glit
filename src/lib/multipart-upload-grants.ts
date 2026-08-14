import { abortMultipartUpload } from "@/lib/b2";
import { getGuestStorageOwnerId } from "@/lib/guest-storage-owner";
import { createAdminClient } from "@/lib/supabase/admin";

export const MULTIPART_GRANT_TTL_SECONDS = Math.min(
  24 * 60 * 60,
  Math.max(
    15 * 60,
    Number(process.env.B2_MULTIPART_GRANT_EXPIRES_SECONDS ?? "86400") ||
      24 * 60 * 60,
  ),
);

export type MultipartUploadGrant = {
  id: string;
  submission_id: string;
  owner_key: string;
  upload_id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  upload_kind: "audio" | "video";
  declared_size_bytes: number;
  part_size_bytes: number;
  part_count: number;
  status:
    | "ACTIVE"
    | "COMPLETING"
    | "COMPLETED"
    | "ABORTING"
    | "ABORTED"
    | "FAILED";
  abort_attempts: number;
  last_abort_attempt_at: string | null;
  expires_at: string;
};

export const getMultipartOwnerKey = (params: {
  submissionUserId?: string | null;
  authenticatedUserId?: string | null;
  guestToken?: string | null;
}) => {
  const memberId = params.submissionUserId ?? params.authenticatedUserId;
  if (memberId) return `user:${memberId}`;
  if (!params.guestToken) return null;
  return `guest:${getGuestStorageOwnerId(params.guestToken)}`;
};

export async function createMultipartGrant(params: {
  submissionId: string;
  ownerKey: string;
  uploadId: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  uploadKind: "audio" | "video";
  declaredSizeBytes: number;
  partSizeBytes: number;
  partCount: number;
}) {
  const admin = createAdminClient();
  const expiresAt = new Date(
    Date.now() + MULTIPART_GRANT_TTL_SECONDS * 1_000,
  ).toISOString();
  const { data, error } = await admin
    .from("multipart_upload_grants")
    .insert({
      submission_id: params.submissionId,
      owner_key: params.ownerKey,
      upload_id: params.uploadId,
      object_key: params.objectKey,
      original_name: params.originalName,
      mime_type: params.mimeType,
      upload_kind: params.uploadKind,
      declared_size_bytes: params.declaredSizeBytes,
      part_size_bytes: params.partSizeBytes,
      part_count: params.partCount,
      status: "ACTIVE",
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "멀티파트 업로드 권한을 저장할 수 없습니다.");
  }
  return data as MultipartUploadGrant;
}

export async function getMultipartGrant(grantId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("multipart_upload_grants")
    .select("*")
    .eq("id", grantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MultipartUploadGrant | null) ?? null;
}

export const multipartGrantMatches = (
  grant: MultipartUploadGrant,
  params: {
    submissionId: string;
    ownerKey: string;
    uploadId: string;
    objectKey: string;
  },
) =>
  grant.submission_id === params.submissionId &&
  grant.owner_key === params.ownerKey &&
  grant.upload_id === params.uploadId &&
  grant.object_key === params.objectKey;

export const getMultipartPartSize = (
  grant: MultipartUploadGrant,
  partNumber: number,
) => {
  if (partNumber < 1 || partNumber > grant.part_count) return null;
  if (partNumber < grant.part_count) return grant.part_size_bytes;
  return (
    grant.declared_size_bytes -
    grant.part_size_bytes * (grant.part_count - 1)
  );
};

const finalizeAbort = async (
  grant: MultipartUploadGrant,
  claimedStatus: "ABORTING",
) => {
  const admin = createAdminClient();
  try {
    await abortMultipartUpload({
      objectKey: grant.object_key,
      uploadId: grant.upload_id,
    });
    const { data, error } = await admin
      .from("multipart_upload_grants")
      .update({ status: "ABORTED", updated_at: new Date().toISOString() })
      .eq("id", grant.id)
      .eq("status", claimedStatus)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      throw new Error("멀티파트 업로드 중단 상태를 저장할 수 없습니다.");
    }
    return true;
  } catch {
    // Keep ABORTING as a retryable lease state. The bounded cleanup RPC below
    // retries it after a cooldown instead of leaking orphan multipart parts.
    return false;
  }
};

export const abortClaimedMultipartGrant = (grant: MultipartUploadGrant) =>
  finalizeAbort(grant, "ABORTING");

export async function abortExpiredMultipartGrant(grant: MultipartUploadGrant) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("multipart_upload_grants")
    .update({
      status: "ABORTING",
      abort_attempts: (grant.abort_attempts ?? 0) + 1,
      last_abort_attempt_at: now,
      updated_at: now,
    })
    .eq("id", grant.id)
    .eq("status", "ACTIVE")
    .lte("expires_at", now)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  return finalizeAbort(data as MultipartUploadGrant, "ABORTING");
}

export async function cleanupExpiredMultipartGrants(limit = 5) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "lease_expired_multipart_upload_aborts",
    { p_limit: Math.max(1, Math.min(20, limit)) },
  );
  if (error) throw new Error(error.message);
  for (const grant of (data ?? []) as MultipartUploadGrant[]) {
    await finalizeAbort(grant, "ABORTING");
  }
}

export async function abortCompletingMultipartGrant(
  grant: MultipartUploadGrant,
) {
  const admin = createAdminClient();
  const attemptedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("multipart_upload_grants")
    .update({
      status: "ABORTING",
      abort_attempts: (grant.abort_attempts ?? 0) + 1,
      last_abort_attempt_at: attemptedAt,
      updated_at: attemptedAt,
    })
    .eq("id", grant.id)
    .eq("status", "COMPLETING")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  return finalizeAbort(data as MultipartUploadGrant, "ABORTING");
}

export async function markMultipartGrantCompleted(grantId: string) {
  const admin = createAdminClient();
  const completedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("multipart_upload_grants")
    .update({
      status: "COMPLETED",
      consumed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", grantId)
    .eq("status", "COMPLETING")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message || "멀티파트 업로드 권한을 소진할 수 없습니다.");
  }
}

export async function markMultipartGrantFailed(
  grantId: string,
  fromStatuses: Array<MultipartUploadGrant["status"]> = ["COMPLETING"],
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("multipart_upload_grants")
    .update({ status: "FAILED", updated_at: new Date().toISOString() })
    .eq("id", grantId)
    .in("status", fromStatuses);
  if (error) throw new Error(error.message);
}
