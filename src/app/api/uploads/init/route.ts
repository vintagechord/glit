import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import {
  getGuestStorageOwnerId,
  getStorageLogId,
} from "@/lib/guest-storage-owner";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import {
  isApplicationFormFile,
  isApplicationFormMime,
  isAudioUploadFile,
  isVideoUploadFile,
} from "@/lib/submission-files";
import {
  getSubmissionUploadBlockMessage,
  getSubmissionUploadBlockReason,
} from "@/lib/submission-upload-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  kind: z.enum(["audio", "video"]),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  title: z.string().max(255).optional(),
  guestToken: z.string().min(8).max(120).optional(),
});

// A single PUT has no server callback if the browser abandons it after B2 has
// accepted the object. Keep that untracked exposure small; larger files use the
// owner-bound multipart grant flow, whose expired parts can be aborted.
const MAX_SINGLE_PUT_BYTES = 128 * 1024 * 1024;
const BYTE_QUOTA_UNIT = 1024 * 1024;
const SINGLE_PUT_SUBMISSION_DAILY_MIB = 4 * 1024;
const SINGLE_PUT_OWNER_DAILY_MIB = 8 * 1024;
const SINGLE_PUT_IP_DAILY_MIB = 8 * 1024;
const configuredExpiresSeconds = Number(
  process.env.B2_PRESIGN_EXPIRES_SECONDS ?? "900",
);
const EXPIRES_SECONDS = Number.isFinite(configuredExpiresSeconds)
  ? Math.min(60 * 60, Math.max(60, Math.trunc(configuredExpiresSeconds)))
  : 900;

const isAllowedUploadFile = (
  kind: "audio" | "video",
  filename: string,
  mimeType: string,
) => {
  if (kind === "audio") {
    return (
      isAudioUploadFile(filename, mimeType) ||
      isApplicationFormFile(filename) ||
      isApplicationFormMime(mimeType)
    );
  }
  return (
    isVideoUploadFile(filename, mimeType) ||
    isApplicationFormFile(filename) ||
    isApplicationFormMime(mimeType)
  );
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestLimit = consumeRateLimit({
    namespace: "upload-init-ip",
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

  const { submissionId, kind, filename, mimeType, sizeBytes, title, guestToken } =
    parsed.data;

  if (sizeBytes > MAX_SINGLE_PUT_BYTES) {
    return NextResponse.json(
      {
        error: "128MB를 초과한 파일은 멀티파트 업로드를 이용해주세요.",
      },
      { status: 413 },
    );
  }
  if (!isAllowedUploadFile(kind, filename, mimeType)) {
    return NextResponse.json(
      {
        error:
          kind === "audio"
            ? "음원 파일은 WAV/MP3/ZIP 또는 신청서 파일(HWP/DOC/DOCX)만 업로드할 수 있습니다."
            : "영상 파일은 MP4/MOV/WMV/MPG 또는 신청서 파일(HWP/DOC/DOCX)만 업로드할 수 있습니다.",
      },
      { status: 400 },
    );
  }

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
    const uploadBlockReason = getSubmissionUploadBlockReason(submission);
    if (uploadBlockReason) {
      return NextResponse.json(
        { error: getSubmissionUploadBlockMessage(uploadBlockReason) },
        { status: 409 },
      );
    }

    const effectiveGuestToken = guestToken ?? submission?.guest_token;
    const ownerIdentifier = submission?.user_id
      ? `user:${submission.user_id}`
      : effectiveGuestToken
        ? `guest:${getGuestStorageOwnerId(effectiveGuestToken)}`
        : user?.id
          ? `user:${user.id}`
          : null;
    if (!ownerIdentifier) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const quotaCost = Math.max(1, Math.ceil(sizeBytes / BYTE_QUOTA_UNIT));
    const quotaChecks = [
      {
        namespace: "upload-single-put-bytes-submission",
        identifier: submissionId,
        limit: SINGLE_PUT_SUBMISSION_DAILY_MIB,
      },
      {
        namespace: "upload-single-put-bytes-owner",
        identifier: ownerIdentifier,
        limit: SINGLE_PUT_OWNER_DAILY_MIB,
      },
      {
        namespace: "upload-single-put-bytes-ip",
        identifier: getRequestIdentifier(request.headers),
        limit: SINGLE_PUT_IP_DAILY_MIB,
      },
    ];
    for (const quota of quotaChecks) {
      const result = consumeRateLimit({
        ...quota,
        cost: quotaCost,
        windowMs: 24 * 60 * 60 * 1_000,
      });
      if (!result.allowed) {
        return NextResponse.json(
          {
            error:
              "단일 파일 업로드 허용량을 초과했습니다. 잠시 후 다시 시도하거나 멀티파트 업로드를 이용해주세요.",
          },
          {
            status: 429,
            headers: { "Retry-After": String(result.retryAfterSeconds) },
          },
        );
      }
    }

    const { client, bucket } = getB2Config();
    const key = buildObjectKey({
      userId:
        submission?.user_id ??
        user?.id ??
        getGuestStorageOwnerId(
          guestToken ?? submission?.guest_token ?? "new",
        ),
      submissionId,
      title,
      filename,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: EXPIRES_SECONDS });

    console.info("[Upload][init] ok", {
      submissionIdHash: getStorageLogId(submissionId),
      kind,
      sizeBytes,
      objectKeyId: getStorageLogId(key),
      bucket,
      tookMs: Date.now() - startedAt,
      userIdHash: user?.id ? getStorageLogId(user.id) : null,
      guest: Boolean(submission?.guest_token ?? guestToken),
    });

    return NextResponse.json({
      ok: true,
      key,
      bucket,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": mimeType },
      maxSizeBytes: MAX_SINGLE_PUT_BYTES,
      expiresInSeconds: EXPIRES_SECONDS,
      submissionId,
    });
  } catch (error) {
    const isConfig = error instanceof B2ConfigError;
    console.error("[Upload][init] error", {
      submissionIdHash: getStorageLogId(submissionId),
      kind,
      sizeBytes,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: isConfig
          ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
          : "업로드 URL을 생성할 수 없습니다.",
      },
      { status: isConfig ? 503 : 500 },
    );
  }
}
