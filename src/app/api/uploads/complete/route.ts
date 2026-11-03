import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { B2ConfigError, getB2Config } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { isSubmissionObjectKeyOwned } from "@/lib/submission-object-key";
import {
  getSubmissionUploadBlockMessage,
  getSubmissionUploadBlockReason,
  getSubmissionUploadConflictMessage,
  shouldStageSubmissionUpload,
} from "@/lib/submission-upload-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { UploadSignatureMismatchError, verifyUploadedObjectSignature } from "@/lib/upload-content-verification";
import { deleteUnreferencedUploadObject } from "@/lib/upload-object-references";
import { getUploadPutGrant, markUploadPutGrantCompleted } from "@/lib/upload-put-grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The file fields are only compared with what /init (or the direct fallback)
// approved; the server-side grant is what gets stored.
const schema = z
  .object({
    submissionId: z.string().uuid(),
    key: z.string().min(1).max(1024).optional(),
    objectKey: z.string().min(1).max(1024).optional(),
    filename: z.string().min(1).max(255).optional(),
    kind: z.string().max(64).optional(),
    mimeType: z.string().max(255).optional(),
    sizeBytes: z.number().int().positive(),
    checksum: z.string().min(8).max(512).optional(),
    durationSeconds: z.number().nonnegative().optional(),
    purpose: z.enum(["SUBMISSION_FILE", "PAYMENT_DOCUMENT"]).optional(),
    guestToken: z.string().min(8).max(120).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.key && !data.objectKey) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "key 또는 objectKey가 필요합니다.",
      });
    }
  });

const mapKind = (kind: string): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const upper = kind.toUpperCase();
  if (upper === "AUDIO" || upper === "VIDEO" || upper === "LYRICS" || upper === "ETC") {
    return upper as "AUDIO" | "VIDEO" | "LYRICS" | "ETC";
  }
  return "ETC";
};

class UnsupportedUploadContentError extends Error {
  constructor() {
    super("파일 형식을 확인할 수 없습니다. 허용된 형식의 파일을 다시 선택해주세요.");
    this.name = "UnsupportedUploadContentError";
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let deleteUnreferencedObjectOnFailure = false;
  const requestLimit = consumeRateLimit({
    namespace: "upload-complete-ip",
    identifier: getRequestIdentifier(request.headers),
    limit: 60,
    windowMs: 60 * 60 * 1_000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }
  const body = await readBoundedJsonBody(request, 16 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = schema.safeParse(body.value);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const { submissionId, guestToken, sizeBytes } = parsed.data;
  const normalizedKey = parsed.data.key ?? parsed.data.objectKey ?? "";
  let normalizedKind: "AUDIO" | "VIDEO" | "LYRICS" | "ETC" | null = null;

  if (!normalizedKey) {
    return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: 400 });
  }

  console.info("[Upload][complete] normalized", {
    submissionIdHash: getStorageLogId(submissionId),
    hadKey: Boolean(parsed.data.key),
    hadObjectKey: Boolean(parsed.data.objectKey),
  });

  try {
    const { user, submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
    if (error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (error === "FORBIDDEN") {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }
    const uploadBlockReason = getSubmissionUploadBlockReason(submission);
    if (uploadBlockReason) {
      return NextResponse.json(
        { error: getSubmissionUploadBlockMessage(uploadBlockReason) },
        { status: 409 },
      );
    }
    const staged = shouldStageSubmissionUpload(submission);
    const { prefix } = getB2Config();
    if (
      !isSubmissionObjectKeyOwned({
        objectKey: normalizedKey,
        prefix,
        submissionId,
        submissionUserId: submission?.user_id ?? user?.id,
        guestToken,
        allowClaimedGuestOwner: Boolean(submission?.user_id),
      })
    ) {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }

    const grant = await getUploadPutGrant(submissionId, normalizedKey);
    if (!grant) {
      return NextResponse.json(
        { error: "업로드 승인 정보를 찾을 수 없습니다. 파일을 다시 선택해주세요." },
        { status: 409 },
      );
    }
    if (grant.status === "PENDING" && !(Date.parse(grant.expires_at) > Date.now())) {
      return NextResponse.json(
        { error: "업로드 유효 시간이 만료되었습니다. 파일을 다시 선택해주세요." },
        { status: 410 },
      );
    }
    normalizedKind = mapKind(grant.upload_kind);
    const purpose = normalizedKind === "ETC" ? "PAYMENT_DOCUMENT" : "SUBMISSION_FILE";
    if (
      sizeBytes !== Number(grant.declared_size_bytes) ||
      (parsed.data.filename !== undefined && parsed.data.filename !== grant.original_name) ||
      (parsed.data.mimeType !== undefined && parsed.data.mimeType !== grant.mime_type) ||
      (parsed.data.kind !== undefined && mapKind(parsed.data.kind) !== normalizedKind) ||
      (parsed.data.purpose !== undefined && parsed.data.purpose !== purpose)
    ) {
      return NextResponse.json(
        { error: "처음 승인된 업로드 정보와 일치하지 않습니다." },
        { status: 400 },
      );
    }

    const { client, bucket } = getB2Config();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
      }),
    );

    const contentLength = head.ContentLength ?? 0;
    if (contentLength !== sizeBytes) {
      // A caller's incorrect declared size cannot authorize deleting an
      // existing staged/live object, including during a payment-state race.
      return NextResponse.json(
        {
          error: "업로드된 파일 크기가 일치하지 않습니다.",
          expected: sizeBytes,
          actual: contentLength,
        },
        { status: 400 },
      );
    }

    // The approved name decides which container check applies. Every allowed
    // extension has one, so "unsupported" means a grant from before the
    // allowlist required an extension and is refused like a mismatch.
    const signature = await verifyUploadedObjectSignature(normalizedKey, grant.original_name);
    if (signature === "unsupported") throw new UnsupportedUploadContentError();
    const admin = createAdminClient();
    const payload = {
      submission_id: submissionId,
      kind: normalizedKind,
      file_path: normalizedKey,
      object_key: normalizedKey,
      original_name: grant.original_name,
      mime: grant.mime_type,
      size: Number(grant.declared_size_bytes),
      checksum: parsed.data.checksum ?? null,
      duration_seconds: parsed.data.durationSeconds ?? null,
      // Downloads are signed on demand; a stored link would outlive the
      // permission check that should guard it.
      access_url: null,
      storage_provider: "b2",
      status: "UPLOADED",
      purpose,
      uploaded_at: new Date().toISOString(),
    };
    // Every applicant upload is provisional. The atomic submission save
    // validates this row and is the only path that can create live metadata.
    deleteUnreferencedObjectOnFailure = true;
    const stagedResult = await admin
      .from("submission_upload_staging")
      .upsert(payload, { onConflict: "submission_id,file_path" })
      .select("id")
      .maybeSingle();
    if (stagedResult.error || !stagedResult.data?.id) {
      throw new Error(
        stagedResult.error?.message || "파일 임시 정보를 저장할 수 없습니다.",
      );
    }
    const stagingId = stagedResult.data.id;
    deleteUnreferencedObjectOnFailure = false;
    // A PENDING grant left by a lost update keeps its object: the staging
    // receipt is a reference the expiry cleanup checks before deleting.
    await markUploadPutGrantCompleted(grant.id).catch(() => undefined);

    console.info("[Upload][complete] ok", {
      submissionIdHash: getStorageLogId(submissionId),
      kind: normalizedKind,
      objectKeyId: getStorageLogId(normalizedKey),
      sizeBytes,
      etagId: head.ETag ? getStorageLogId(head.ETag) : null,
      userIdHash: user?.id ? getStorageLogId(user.id) : null,
      guest: Boolean(submission?.guest_token ?? guestToken),
      tookMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      verified: signature === "matched",
      verification: { size: true, signature, codec: "not_checked", contents: "not_checked" },
      etag: head.ETag,
      contentLength,
      attachmentId: null,
      stagingId,
      staged,
      key: normalizedKey,
      submissionId,
    });
  } catch (error) {
    const uploadConflictMessage = getSubmissionUploadConflictMessage(error);
    const rejectedContent =
      error instanceof UploadSignatureMismatchError ||
      error instanceof UnsupportedUploadContentError;
    if (deleteUnreferencedObjectOnFailure || rejectedContent) {
      // Bytes that failed verification, or never got a receipt, are removed
      // unless another live or staged row already points at the same key.
      await Promise.resolve()
        .then(() =>
          deleteUnreferencedUploadObject(createAdminClient(), normalizedKey, {
            prefix: getB2Config().prefix,
            submissionId,
          }),
        )
        .catch(() => undefined);
    }
    const isConfig = error instanceof B2ConfigError;
    console.error("[Upload][complete] error", {
      submissionIdHash: getStorageLogId(submissionId),
      kind: normalizedKind,
      objectKeyId: getStorageLogId(normalizedKey),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error:
          uploadConflictMessage ??
          (rejectedContent && error instanceof Error ? error.message : null) ??
          (isConfig
            ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
            : "업로드 확인 중 오류가 발생했습니다. 다시 시도해주세요."),
      },
      { status: uploadConflictMessage ? 409 : rejectedContent ? 400 : isConfig ? 503 : 500 },
    );
  }
}
