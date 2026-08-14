import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  abortCompletingMultipartGrant,
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
  deleteObject,
  getB2Config,
  presignGetUrl,
} from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageLogId } from "@/lib/guest-storage-owner";

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

export async function POST(request: Request) {
  const startedAt = Date.now();
  let claimedGrant: MultipartUploadGrant | null = null;
  let completedObjectKey: string | null = null;
  let recordedObjectKey: string | null = null;
  const requestLimit = consumeRateLimit({
    namespace: "upload-multipart-complete-ip",
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
  const body = await readBoundedJsonBody(request, 256 * 1024);
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

  const {
    grantId,
    submissionId,
    key,
    uploadId,
    parts,
    filename,
    mimeType,
    sizeBytes,
    kind,
    checksum,
    durationSeconds,
    guestToken,
  } = parsed.data;

  const normalizedKind = kind ? mapKind(kind) : inferKind(filename, mimeType);

  try {
    const { user, submission, error } = await ensureSubmissionOwner(
      submissionId,
      guestToken,
    );
    if (error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (error === "FORBIDDEN") {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }
    const ownerKey = getMultipartOwnerKey({
      submissionUserId: submission?.user_id,
      authenticatedUserId: user?.id,
      guestToken: guestToken ?? submission?.guest_token,
    });
    const grant = await getMultipartGrant(grantId);
    if (
      !ownerKey ||
      !grant ||
      !multipartGrantMatches(grant, {
        submissionId,
        ownerKey,
        uploadId,
        objectKey: key,
      })
    ) {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }
    if (grant.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "이미 종료된 업로드입니다. 업로드를 다시 시작해주세요." },
        { status: 409 },
      );
    }
    if (new Date(grant.expires_at).getTime() <= Date.now()) {
      await abortExpiredMultipartGrant(grant);
      return NextResponse.json(
        { error: "업로드 유효 시간이 만료되었습니다. 다시 시작해주세요." },
        { status: 410 },
      );
    }
    if (
      grant.declared_size_bytes !== sizeBytes ||
      grant.original_name !== filename ||
      grant.mime_type !== mimeType ||
      grant.upload_kind.toUpperCase() !== normalizedKind
    ) {
      return NextResponse.json(
        { error: "처음 승인된 업로드 정보와 일치하지 않습니다." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { error: claimError } = await admin.rpc(
      "claim_multipart_upload_grant",
      {
        p_grant_id: grant.id,
        p_submission_id: submissionId,
        p_upload_id: uploadId,
        p_object_key: key,
        p_owner_key: ownerKey,
        p_part_numbers: parts.map((part) => part.partNumber),
      },
    );
    if (claimError) {
      const isPartMismatch = claimError.message.includes("MULTIPART_PARTS_MISMATCH");
      const isExpired = claimError.message.includes("MULTIPART_GRANT_EXPIRED");
      return NextResponse.json(
        {
          error: isExpired
            ? "업로드 유효 시간이 만료되었습니다. 다시 시작해주세요."
            : isPartMismatch
              ? "업로드 조각 목록이 일치하지 않습니다."
              : "이미 종료되었거나 유효하지 않은 업로드입니다.",
        },
        { status: isExpired ? 410 : isPartMismatch ? 400 : 409 },
      );
    }
    claimedGrant = grant;

    await completeMultipartUpload({
      objectKey: key,
      uploadId,
      parts: parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
      })),
    });
    completedObjectKey = key;

    const { client, bucket } = getB2Config();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const contentLength = head.ContentLength ?? 0;
    if (contentLength !== grant.declared_size_bytes) {
      await deleteObject(key).catch((cleanupError) => {
        console.error("[Upload][multipart][complete] mismatched object cleanup failed", {
          submissionIdHash: getStorageLogId(submissionId),
          errorName:
            cleanupError instanceof Error ? cleanupError.name : "UnknownError",
        });
      });
      await markMultipartGrantFailed(grant.id);
      claimedGrant = null;
      completedObjectKey = null;
      return NextResponse.json(
        {
          error: "업로드된 파일 크기가 일치하지 않습니다.",
          expected: grant.declared_size_bytes,
          actual: contentLength,
        },
        { status: 400 },
      );
    }

    const accessUrl = await presignGetUrl(
      key,
      Number(process.env.B2_ACCESS_URL_EXPIRES_SECONDS ?? "86400"),
    ).catch(() => null);
    const payload = {
      submission_id: submissionId,
      kind: normalizedKind,
      file_path: key,
      object_key: key,
      original_name: filename,
      mime: mimeType,
      size: grant.declared_size_bytes,
      checksum: checksum ?? null,
      duration_seconds: durationSeconds ?? null,
      access_url: accessUrl,
      storage_provider: "b2",
      status: "UPLOADED",
      uploaded_at: new Date().toISOString(),
    };
    let attachmentId: string | null = null;
    let insertPayload = { ...payload } as Record<string, unknown>;
    let inserted:
      | { id?: string | null }
      | null
      | undefined;
    let insertError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await admin
        .from("submission_files")
        .insert(insertPayload)
        .select("id")
        .maybeSingle();
      inserted = result.data as { id?: string | null } | null;
      insertError = result.error as { code?: string; message?: string } | null;
      if (!insertError) {
        break;
      }
      if (insertError.code === "PGRST204") {
        const match = insertError.message?.match(/column \"(.+?)\"/);
        const missing = match?.[1];
        if (missing && missing in insertPayload) {
          const nextPayload = { ...insertPayload };
          delete nextPayload[missing];
          insertPayload = nextPayload;
          continue;
        }
      }
      break;
    }
    if (insertError || !inserted?.id) {
      throw new Error(insertError?.message || "파일 정보를 저장할 수 없습니다.");
    }
    attachmentId = inserted.id;
    recordedObjectKey = key;
    await markMultipartGrantCompleted(grant.id);
    claimedGrant = null;
    completedObjectKey = null;
    recordedObjectKey = null;

    console.info("[Upload][multipart][complete] ok", {
      submissionIdHash: getStorageLogId(submissionId),
      objectKeyId: getStorageLogId(key),
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
      attachmentId,
      key,
      submissionId,
      accessUrl,
    });
  } catch (error) {
    if (recordedObjectKey) {
      const admin = createAdminClient();
      const deleteResult = await admin
        .from("submission_files")
        .delete()
        .eq("submission_id", submissionId)
        .eq("file_path", recordedObjectKey)
        .select("id");
      if (deleteResult.error || !deleteResult.data?.length) {
        // Preserve the B2 object when its metadata row could not be removed;
        // deleting it would leave a broken live reference. COMPLETING is a
        // fail-closed reconciliation state and cannot issue more part URLs.
        if (claimedGrant) {
          await markMultipartGrantCompleted(claimedGrant.id).catch(
            () => undefined,
          );
        }
        console.error("[Upload][multipart][complete] reconciliation pending", {
          submissionIdHash: getStorageLogId(submissionId),
          objectKeyId: getStorageLogId(recordedObjectKey),
        });
        return NextResponse.json(
          {
            ok: true,
            verified: true,
            processing: true,
            key: recordedObjectKey,
            submissionId,
          },
          { status: 202 },
        );
      }
      recordedObjectKey = null;
    }
    if (claimedGrant) {
      await abortCompletingMultipartGrant(claimedGrant).catch(() => false);
    }
    if (completedObjectKey) {
      await deleteObject(completedObjectKey).catch(() => undefined);
    }
    const isConfig = error instanceof B2ConfigError;
    console.error("[Upload][multipart][complete] error", {
      submissionIdHash: getStorageLogId(submissionId),
      objectKeyId: getStorageLogId(key),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: isConfig
          ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
          : "업로드 완료 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
      },
      { status: isConfig ? 503 : 500 },
    );
  }
}
