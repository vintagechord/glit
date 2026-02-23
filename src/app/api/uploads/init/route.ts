import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  kind: z.enum(["audio", "video"]),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  title: z.string().optional(),
  guestToken: z.string().min(8).optional(),
});

const MAX_AUDIO_BYTES = 1 * 1024 * 1024 * 1024; // 1GB
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
const EXPIRES_SECONDS = Number(process.env.B2_PRESIGN_EXPIRES_SECONDS ?? "900");

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

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
            ? "음원 파일은 최대 1GB까지 업로드할 수 있습니다."
            : "뮤직비디오는 최대 4GB까지 업로드할 수 있습니다.",
      },
      { status: 413 },
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

    const { client, bucket } = getB2Config();
    const key = buildObjectKey({
      userId:
        submission?.user_id ??
        user?.id ??
        `guest-${guestToken ?? submission?.guest_token ?? "new"}`,
      submissionId,
      title,
      filename,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: EXPIRES_SECONDS });

    console.info("[Upload][init] ok", {
      submissionId,
      kind,
      sizeBytes,
      key,
      bucket,
      tookMs: Date.now() - startedAt,
      user: user?.id ?? null,
      guest: Boolean(submission?.guest_token ?? guestToken),
    });

    return NextResponse.json({
      ok: true,
      key,
      bucket,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": mimeType },
      maxSizeBytes: maxSize,
      expiresInSeconds: EXPIRES_SECONDS,
      submissionId,
    });
  } catch (error) {
    const isConfig = error instanceof B2ConfigError;
    const message =
      isConfig
        ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
        : error instanceof Error
          ? error.message
          : "업로드 URL을 생성할 수 없습니다.";
    console.error("[Upload][init] error", {
      submissionId,
      kind,
      sizeBytes,
      user: null,
      raw: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: message },
      { status: isConfig ? 503 : 500 },
    );
  }
}
