import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  B2ConfigError,
  deleteObject,
  getB2Config,
  presignGetUrl,
} from "@/lib/b2";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  if (kind.toLowerCase() === "audio") return "AUDIO";
  if (kind.toLowerCase() === "video") return "VIDEO";
  if (kind.toLowerCase() === "lyrics") return "LYRICS";
  return "ETC";
};

const inferKind = (filename: string | undefined, mimeType: string | undefined): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.includes("text") || name.endsWith(".lrc") || name.endsWith(".txt")) return "LYRICS";
  if (name.match(/\.(wav|mp3|flac|aiff|aac|m4a|ogg)$/)) return "AUDIO";
  if (name.match(/\.(mp4|mov|mkv|webm)$/)) return "VIDEO";
  return "ETC";
};

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
  const rawKey = parsed.data.key ?? parsed.data.objectKey ?? "";
  const normalizedKey = rawKey;
  const normalizedFilename =
    parsed.data.filename ||
    (() => {
      const parts = normalizedKey.split("/");
      return parts[parts.length - 1] || normalizedKey;
    })();
  const normalizedMime = parsed.data.mimeType || "application/octet-stream";
  const normalizedKind = parsed.data.kind
    ? mapKind(parsed.data.kind)
    : inferKind(normalizedFilename, normalizedMime);

  if (!normalizedKey) {
    return NextResponse.json({ error: "업로드 정보를 확인해주세요." }, { status: 400 });
  }

  console.info("[Upload][complete] normalized", {
    submissionIdHash: getStorageLogId(submissionId),
    hadKey: Boolean(parsed.data.key),
    hadObjectKey: Boolean(parsed.data.objectKey),
    inferredKind: !parsed.data.kind,
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

    const { client, bucket } = getB2Config();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
      }),
    );

    const contentLength = head.ContentLength ?? 0;
    if (contentLength !== sizeBytes) {
      await deleteObject(normalizedKey).catch((cleanupError) => {
        console.error("[Upload][complete] mismatched object cleanup failed", {
          submissionIdHash: getStorageLogId(submissionId),
          errorName:
            cleanupError instanceof Error ? cleanupError.name : "UnknownError",
        });
      });
      return NextResponse.json(
        {
          error: "업로드된 파일 크기가 일치하지 않습니다.",
          expected: sizeBytes,
          actual: contentLength,
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const expires = Number(process.env.B2_ACCESS_URL_EXPIRES_SECONDS ?? "86400");
    const accessUrl = await presignGetUrl(normalizedKey, expires).catch(() => null);
    const payload = {
      submission_id: submissionId,
      kind: normalizedKind,
      file_path: normalizedKey,
      object_key: normalizedKey,
      original_name: normalizedFilename,
      mime: normalizedMime,
      size: sizeBytes,
      checksum: parsed.data.checksum ?? null,
      duration_seconds: parsed.data.durationSeconds ?? null,
      access_url: accessUrl,
      storage_provider: "b2",
      status: "UPLOADED",
      purpose: parsed.data.purpose ?? "SUBMISSION_FILE",
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
      verified: true,
      etag: head.ETag,
      contentLength,
      attachmentId: null,
      stagingId,
      staged,
      key: normalizedKey,
      submissionId,
      accessUrl,
    });
  } catch (error) {
    const uploadConflictMessage = getSubmissionUploadConflictMessage(error);
    if (deleteUnreferencedObjectOnFailure) {
      const admin = createAdminClient();
      const [liveReference, stagedReference] = await Promise.all([
        admin
          .from("submission_files")
          .select("id")
          .eq("submission_id", submissionId)
          .eq("file_path", normalizedKey)
          .limit(1)
          .maybeSingle(),
        admin
          .from("submission_upload_staging")
          .select("id")
          .eq("submission_id", submissionId)
          .eq("file_path", normalizedKey)
          .limit(1)
          .maybeSingle(),
      ]);
      if (
        !liveReference.error &&
        !liveReference.data &&
        !stagedReference.error &&
        !stagedReference.data
      ) {
        await deleteObject(normalizedKey).catch(() => undefined);
      }
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
          (isConfig
            ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
            : "업로드 확인 중 오류가 발생했습니다. 다시 시도해주세요."),
      },
      { status: uploadConflictMessage ? 409 : isConfig ? 503 : 500 },
    );
  }
}
