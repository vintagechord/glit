import { NextResponse } from "next/server";
import { z } from "zod";

import {
  abortMultipartUpload,
  B2ConfigError,
  buildObjectKey,
  createMultipartUpload,
} from "@/lib/b2";
import {
  getGuestStorageOwnerId,
  getStorageLogId,
} from "@/lib/guest-storage-owner";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import {
  cleanupExpiredMultipartGrants,
  createMultipartGrant,
  getMultipartOwnerKey,
  MULTIPART_GRANT_TTL_SECONDS,
} from "@/lib/multipart-upload-grants";
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

const MAX_AUDIO_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PARTS = 10000;

const DEFAULT_PART_SIZE_MB_RAW = Number(
  process.env.B2_MULTIPART_PART_SIZE_MB ?? "16",
);
const DEFAULT_PART_SIZE_MB = Number.isFinite(DEFAULT_PART_SIZE_MB_RAW)
  ? Math.max(5, DEFAULT_PART_SIZE_MB_RAW)
  : 16;

const PRESIGN_EXPIRES_SECONDS = Math.min(
  60 * 60,
  Math.max(
    60,
    Number(
      process.env.B2_MULTIPART_PRESIGN_EXPIRES_SECONDS ??
        process.env.B2_PRESIGN_EXPIRES_SECONDS ??
        "1200",
    ) || 1200,
  ),
);

const resolvePartSize = (sizeBytes: number) => {
  const base = Math.max(
    MIN_PART_SIZE,
    Math.ceil(sizeBytes / MAX_PARTS),
    DEFAULT_PART_SIZE_MB * 1024 * 1024,
  );
  const rounded = Math.ceil(base / MIN_PART_SIZE) * MIN_PART_SIZE;
  return Math.max(MIN_PART_SIZE, rounded);
};

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
  let pendingUpload: { objectKey: string; uploadId: string } | null = null;
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

  const maxSize = kind === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (sizeBytes > maxSize) {
    return NextResponse.json(
      {
        error:
          kind === "audio"
            ? "음원 파일은 최대 4GB까지 업로드할 수 있습니다."
            : "뮤직비디오는 최대 4GB까지 업로드할 수 있습니다.",
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
    await cleanupExpiredMultipartGrants().catch(() => undefined);
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

    const effectiveGuestToken = guestToken ?? submission?.guest_token;
    const userId =
      submission?.user_id ??
      user?.id ??
      getGuestStorageOwnerId(effectiveGuestToken ?? "new");
    const ownerKey = getMultipartOwnerKey({
      submissionUserId: submission?.user_id,
      authenticatedUserId: user?.id,
      guestToken: effectiveGuestToken,
    });
    if (!ownerKey) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const key = buildObjectKey({
      userId,
      submissionId,
      title,
      filename,
    });

    const uploadId = await createMultipartUpload({
      objectKey: key,
      contentType: mimeType,
    });
    pendingUpload = { objectKey: key, uploadId };

    const partSize = resolvePartSize(sizeBytes);
    const partCount = Math.ceil(sizeBytes / partSize);
    const grant = await createMultipartGrant({
      submissionId,
      ownerKey,
      uploadId,
      objectKey: key,
      originalName: filename,
      mimeType,
      uploadKind: kind,
      declaredSizeBytes: sizeBytes,
      partSizeBytes: partSize,
      partCount,
    });
    pendingUpload = null;

    console.info("[Upload][multipart][init] ok", {
      submissionIdHash: getStorageLogId(submissionId),
      kind,
      sizeBytes,
      partSize,
      partCount,
      objectKeyId: getStorageLogId(key),
      tookMs: Date.now() - startedAt,
      userIdHash: user?.id ? getStorageLogId(user.id) : null,
      guest: Boolean(submission?.guest_token ?? guestToken),
    });

    return NextResponse.json({
      ok: true,
      key,
      uploadId,
      grantId: grant.id,
      partSize,
      partCount,
      expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
      grantExpiresInSeconds: MULTIPART_GRANT_TTL_SECONDS,
      submissionId,
    });
  } catch (error) {
    if (pendingUpload) {
      await abortMultipartUpload(pendingUpload).catch(() => undefined);
    }
    const isConfig = error instanceof B2ConfigError;
    console.error("[Upload][multipart][init] error", {
      submissionIdHash: getStorageLogId(submissionId),
      kind,
      sizeBytes,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: isConfig
          ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
          : "멀티파트 업로드를 준비할 수 없습니다.",
      },
      { status: isConfig ? 503 : 500 },
    );
  }
}
