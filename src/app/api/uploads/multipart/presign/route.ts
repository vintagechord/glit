import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, presignUploadPart } from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import {
  abortExpiredMultipartGrant,
  getMultipartGrant,
  getMultipartOwnerKey,
  getMultipartPartSize,
  multipartGrantMatches,
} from "@/lib/multipart-upload-grants";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  grantId: z.string().uuid(),
  submissionId: z.string().uuid(),
  key: z.string().min(1).max(1024),
  uploadId: z.string().min(1).max(1024),
  partNumbers: z
    .array(z.number().int().min(1).max(10_000))
    .min(1)
    .max(1000)
    .refine((values) => new Set(values).size === values.length),
  guestToken: z.string().min(8).max(120).optional(),
});

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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestLimit = consumeRateLimit({
    namespace: "upload-multipart-presign-ip",
    identifier: getRequestIdentifier(request.headers),
    limit: 120,
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

  const { grantId, submissionId, key, uploadId, partNumbers, guestToken } =
    parsed.data;

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
    const expiresAt = new Date(grant.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await abortExpiredMultipartGrant(grant);
      return NextResponse.json(
        { error: "업로드 유효 시간이 만료되었습니다. 다시 시작해주세요." },
        { status: 410 },
      );
    }
    const requestedParts = partNumbers.map((partNumber) => ({
      partNumber,
      sizeBytes: getMultipartPartSize(grant, partNumber),
    }));
    if (requestedParts.some((part) => part.sizeBytes === null)) {
      return NextResponse.json(
        { error: "업로드 조각 번호가 유효하지 않습니다." },
        { status: 400 },
      );
    }
    const expiresInSeconds = Math.max(
      1,
      Math.min(
        PRESIGN_EXPIRES_SECONDS,
        Math.floor((expiresAt - Date.now()) / 1_000),
      ),
    );

    const urls = await Promise.all(
      requestedParts.map(async ({ partNumber, sizeBytes }) => ({
        partNumber,
        sizeBytes: sizeBytes!,
        url: await presignUploadPart({
          objectKey: key,
          uploadId,
          partNumber,
          contentLength: sizeBytes!,
          expiresInSeconds,
        }),
      })),
    );

    console.info("[Upload][multipart][presign] ok", {
      submissionIdHash: getStorageLogId(submissionId),
      objectKeyId: getStorageLogId(key),
      uploadId: getStorageLogId(uploadId),
      partCount: partNumbers.length,
      tookMs: Date.now() - startedAt,
      guest: Boolean(submission?.guest_token ?? guestToken),
    });

    return NextResponse.json({
      ok: true,
      urls,
      expiresInSeconds,
    });
  } catch (error) {
    const isConfig = error instanceof B2ConfigError;
    console.error("[Upload][multipart][presign] error", {
      submissionIdHash: getStorageLogId(submissionId),
      objectKeyId: getStorageLogId(key),
      uploadId: getStorageLogId(uploadId),
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
