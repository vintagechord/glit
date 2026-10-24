import { NextResponse } from "next/server";
import { HeadObjectCommand, type HeadObjectCommandOutput } from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  abortExpiredMultipartGrant,
  getMultipartGrant,
  getMultipartOwnerKey,
  markMultipartGrantCompleted,
  markMultipartGrantFailed,
  multipartGrantMatches,
  type MultipartUploadGrant,
} from "@/lib/multipart-upload-grants";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  B2ConfigError,
  completeMultipartUpload,
  getB2Config,
  presignGetUrl,
} from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import { UploadSignatureMismatchError, verifyUploadedObjectSignature } from "@/lib/upload-content-verification";
import { multipartCompletionManifest, isMissingUploadObject, MultipartCompletionPendingError, MultipartCompletionConflictError } from "@/lib/multipart-upload-completion";
import {
  getSubmissionUploadBlockMessage,
  getSubmissionUploadBlockReason,
  getSubmissionUploadConflictMessage,
  shouldStageSubmissionUpload,
} from "@/lib/submission-upload-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  grantId: z.string().uuid(),
  submissionId: z.string().uuid(),
  key: z.string().min(1).max(1024),
  uploadId: z.string().min(1).max(1024),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().min(8).max(128).regex(/^[A-Za-z0-9+/_=-]+$/),
      }),
    )
    .min(1)
    .max(10_000)
    .refine(
      (parts) => new Set(parts.map((part) => part.partNumber)).size === parts.length,
    ),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  kind: z.enum(["audio", "video", "AUDIO", "VIDEO"]).optional(),
  checksum: z.string().min(8).max(512).optional(),
  durationSeconds: z.number().nonnegative().optional(),
  guestToken: z.string().min(8).max(120).optional(),
});

const mapKind = (kind: string): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const upper = kind.toUpperCase();
  if (upper === "AUDIO" || upper === "VIDEO" || upper === "LYRICS" || upper === "ETC") {
    return upper as "AUDIO" | "VIDEO" | "LYRICS" | "ETC";
  }
  if (kind.toLowerCase() === "audio") return "AUDIO";
  if (kind.toLowerCase() === "video") return "VIDEO";
  if (kind.toLowerCase() === "lyrics") return "LYRICS";
  return "ETC";
};

const inferKind = (filename: string, mimeType: string): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.includes("text") || name.endsWith(".lrc") || name.endsWith(".txt")) return "LYRICS";
  if (name.match(/\.(wav|mp3|flac|aiff|aac|m4a|ogg)$/)) return "AUDIO";
  if (name.match(/\.(mp4|mov|mkv|webm)$/)) return "VIDEO";
  return "ETC";
};

type VerifiedUploadRow = { id: string; original_name: string; mime: string; size: number; storage_provider: string; status: string };

export async function POST(request: Request) {
  const startedAt = Date.now();
  let completionGrant: MultipartUploadGrant | null = null;
  const requestLimit = consumeRateLimit({ namespace: "upload-multipart-complete-ip", identifier: getRequestIdentifier(request.headers), limit: 60, windowMs: 60 * 60 * 1_000 });
  if (!requestLimit.allowed) return NextResponse.json({ error: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429, headers: { "Retry-After": String(requestLimit.retryAfterSeconds) } });
  const body = await readBoundedJsonBody(request, 256 * 1024);
  if (!body.ok) return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: body.reason === "too_large" ? 413 : 400 });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: 400 });
  const { grantId, submissionId, key, uploadId, parts, filename, mimeType, sizeBytes, kind, checksum, durationSeconds, guestToken } = parsed.data;
  const normalizedKind = kind ? mapKind(kind) : inferKind(filename, mimeType);

  try {
    const { user, submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
    if (error === "NOT_FOUND") return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    if (error === "UNAUTHORIZED") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (error === "FORBIDDEN") return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    const uploadBlockReason = getSubmissionUploadBlockReason(submission);
    if (uploadBlockReason) return NextResponse.json({ error: getSubmissionUploadBlockMessage(uploadBlockReason) }, { status: 409 });
    const staged = shouldStageSubmissionUpload(submission);
    const ownerKey = getMultipartOwnerKey({ submissionUserId: submission?.user_id, authenticatedUserId: user?.id, guestToken: guestToken ?? submission?.guest_token });
    const grant = await getMultipartGrant(grantId);
    if (!ownerKey || !grant || !multipartGrantMatches(grant, { submissionId, ownerKey, uploadId, objectKey: key })) {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }
    const expiresAt = new Date(grant.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      if (grant.status === "ACTIVE") await abortExpiredMultipartGrant(grant);
      return NextResponse.json({ error: "업로드 유효 시간이 만료되었습니다. 다시 시작해주세요." }, { status: 410 });
    }
    if (grant.declared_size_bytes !== sizeBytes || grant.original_name !== filename || grant.mime_type !== mimeType || grant.upload_kind.toUpperCase() !== normalizedKind) {
      return NextResponse.json({ error: "처음 승인된 업로드 정보와 일치하지 않습니다." }, { status: 400 });
    }
    const manifestHash = multipartCompletionManifest(parts);
    const admin = createAdminClient();
    const { data: completionState, error: claimError } = await admin.rpc("claim_multipart_upload_completion", {
      p_grant_id: grant.id, p_submission_id: submissionId, p_upload_id: uploadId,
      p_object_key: key, p_owner_key: ownerKey, p_part_numbers: parts.map(part => part.partNumber), p_manifest_hash: manifestHash,
    });
    if (claimError) {
      const expired = claimError.message.includes("MULTIPART_GRANT_EXPIRED");
      const mismatchedParts = claimError.message.includes("MULTIPART_PARTS_MISMATCH");
      const forbidden = claimError.message.includes("MULTIPART_GRANT_MISMATCH");
      const migrationUnavailable = ["PGRST202", "42883", "42703"].includes(claimError.code ?? "");
      return NextResponse.json({ error: migrationUnavailable
        ? "업로드 완료 확인 기능을 준비 중입니다. 잠시 후 다시 시도해주세요."
        : expired ? "업로드 유효 시간이 만료되었습니다. 다시 시작해주세요."
          : mismatchedParts ? "업로드 조각 목록이 일치하지 않습니다."
            : "이미 종료되었거나 처음 완료 요청과 다른 업로드입니다." },
      { status: migrationUnavailable ? 503 : expired ? 410 : forbidden ? 403 : mismatchedParts ? 400 : 409 });
    }
    if (!["START", "COMPLETING", "COMPLETED"].includes(String(completionState))) throw new MultipartCompletionPendingError();
    completionGrant = grant;
    const { client, bucket } = getB2Config();
    const readHead = () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    let head: HeadObjectCommandOutput | null = null;
    if (completionState !== "START") {
      try { head = await readHead(); }
      catch (cause) { if (!isMissingUploadObject(cause)) throw cause; }
    }
    if (!head && completionState === "COMPLETED") throw new MultipartCompletionPendingError();
    if (!head) {
      // A transport failure may follow a successful provider commit. Read the
      // object before deciding whether completion failed; never delete on doubt.
      let completionFailure: unknown;
      try { await completeMultipartUpload({ objectKey: key, uploadId, parts }); }
      catch (cause) { completionFailure = cause; }
      try { head = await readHead(); }
      catch (cause) {
        if (isMissingUploadObject(cause) && completionFailure instanceof Error && ["InvalidPart", "InvalidPartOrder", "EntityTooSmall"].includes(completionFailure.name)) {
          await markMultipartGrantFailed(grant.id);
          completionGrant = null;
          return NextResponse.json({ error: "업로드 조각이 일치하지 않습니다. 파일을 다시 선택해주세요." }, { status: 400 });
        }
        throw new MultipartCompletionPendingError();
      }
    }
    const contentLength = head.ContentLength ?? 0;
    if (contentLength !== grant.declared_size_bytes) {
      if (completionState !== "COMPLETED") await markMultipartGrantFailed(grant.id);
      completionGrant = null;
      return NextResponse.json({ error: "업로드된 파일 크기가 일치하지 않습니다.", expected: grant.declared_size_bytes, actual: contentLength }, { status: 400 });
    }
    const signature = await verifyUploadedObjectSignature(key, grant.original_name);
    let stagingId: string | null = null;
    let existing: VerifiedUploadRow | null = null;
    const readReceipt = async () => {
      const fields = "id,original_name,mime,size,storage_provider,status";
      const [pending, live] = await Promise.all([
        admin.from("submission_upload_staging").select(fields).eq("submission_id", submissionId).eq("file_path", key).maybeSingle(),
        admin.from("submission_files").select(fields).eq("submission_id", submissionId).eq("file_path", key).maybeSingle(),
      ]);
      if (pending.error || live.error) throw new MultipartCompletionPendingError();
      existing = (live.data ?? pending.data) as VerifiedUploadRow | null;
      if (existing && (existing.original_name !== filename || existing.mime !== mimeType || Number(existing.size) !== sizeBytes || existing.storage_provider !== "b2" || existing.status !== "UPLOADED")) {
        throw new MultipartCompletionConflictError();
      }
      stagingId = pending.data?.id ?? null;
    };
    if (completionState !== "START") {
      await readReceipt();
      if (completionState === "COMPLETED" && !existing) {
        return NextResponse.json({ error: "현재 신청에 연결된 업로드 기록을 확인할 수 없습니다." }, { status: 409 });
      }
    }
    const accessUrl = await presignGetUrl(key, Number(process.env.B2_ACCESS_URL_EXPIRES_SECONDS ?? "86400")).catch(() => null);
    if (!existing) {
      // Only a size/signature-checked object reaches provisional metadata. The
      // atomic application save alone publishes submission_files.
      const payload = { submission_id: submissionId, kind: normalizedKind, file_path: key, object_key: key, original_name: filename, mime: mimeType,
        size: grant.declared_size_bytes, checksum: checksum ?? null, duration_seconds: durationSeconds ?? null,
        access_url: accessUrl, storage_provider: "b2", status: "UPLOADED", uploaded_at: new Date().toISOString() };
      // Concurrent identical completions must not overwrite the first receipt
      // (especially uploaded_at) or reset its submission/retention timestamp.
      const stagedResult = await admin.from("submission_upload_staging").upsert(payload, { onConflict: "submission_id,file_path", ignoreDuplicates: true }).select("id").maybeSingle();
      if (stagedResult.error) {
        // Preserve the database's edit/payment race guard as a conflict. A
        // transport failure still leaves the same manifest available to retry.
        if (getSubmissionUploadConflictMessage(stagedResult.error.message)) throw new Error(stagedResult.error.message);
        throw new MultipartCompletionPendingError();
      }
      if (stagedResult.data?.id) stagingId = stagedResult.data.id;
      else {
        await readReceipt();
        if (!existing) throw new MultipartCompletionPendingError();
      }
    }
    if (completionState !== "COMPLETED") {
      try { await markMultipartGrantCompleted(grant.id); }
      catch {
        // Another identical request or a lost database response may already
        // have committed the receipt. Confirm it instead of deleting metadata.
        const confirmed = await getMultipartGrant(grant.id).catch(() => null);
        if (!confirmed || confirmed.status !== "COMPLETED" || confirmed.completion_manifest_hash !== manifestHash || !multipartGrantMatches(confirmed, { submissionId, ownerKey, uploadId, objectKey: key })) {
          throw new MultipartCompletionPendingError();
        }
      }
    }
    completionGrant = null;
    console.info("[Upload][multipart][complete] ok", { submissionIdHash: getStorageLogId(submissionId), objectKeyId: getStorageLogId(key), sizeBytes,
      etagId: head.ETag ? getStorageLogId(head.ETag) : null, userIdHash: user?.id ? getStorageLogId(user.id) : null,
      guest: Boolean(submission?.guest_token ?? guestToken), tookMs: Date.now() - startedAt });
    return NextResponse.json({ ok: true, verified: signature === "matched", verification: { size: true, signature, codec: "not_checked", contents: "not_checked" },
      etag: head.ETag, contentLength, attachmentId: null, stagingId, staged, key, submissionId, accessUrl });
  } catch (error) {
    if (error instanceof UploadSignatureMismatchError && completionGrant) await markMultipartGrantFailed(completionGrant.id).catch(() => undefined);
    // COMPLETING plus the immutable manifest is a retryable receipt. Failed or
    // uncertain persistence must never erase a verified row or its object.
    const conflict = getSubmissionUploadConflictMessage(error) ?? (error instanceof MultipartCompletionConflictError ? error.message : null);
    const configuration = error instanceof B2ConfigError;
    const pending = error instanceof MultipartCompletionPendingError;
    console.error("[Upload][multipart][complete] error", { submissionIdHash: getStorageLogId(submissionId), objectKeyId: getStorageLogId(key), errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: conflict ?? (error instanceof UploadSignatureMismatchError ? error.message : pending ? error.message : configuration ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요." : "업로드 완료 처리 중 오류가 발생했습니다. 다시 시도해주세요.") },
      { status: conflict ? 409 : error instanceof UploadSignatureMismatchError ? 400 : pending || configuration ? 503 : 500 });
  }
}
