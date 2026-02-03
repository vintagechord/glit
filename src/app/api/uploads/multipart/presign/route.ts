import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, presignUploadPart } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  partNumbers: z.array(z.number().int().positive()).min(1).max(1000),
  guestToken: z.string().min(8).optional(),
});

const PRESIGN_EXPIRES_SECONDS = Number(
  process.env.B2_MULTIPART_PRESIGN_EXPIRES_SECONDS ??
    process.env.B2_PRESIGN_EXPIRES_SECONDS ??
    "1200",
);

const keyMatchesSubmission = (key: string, submissionId: string) =>
  key.includes(`/${submissionId}/`);

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

  const { submissionId, key, uploadId, partNumbers, guestToken } = parsed.data;

  try {
    const { submission, error } = await ensureSubmissionOwner(
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

    if (!keyMatchesSubmission(key, submissionId)) {
      return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
    }

    const urls = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await presignUploadPart({
          objectKey: key,
          uploadId,
          partNumber,
          expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
        }),
      })),
    );

    console.info("[Upload][multipart][presign] ok", {
      submissionId,
      key,
      uploadId,
      partCount: partNumbers.length,
      tookMs: Date.now() - startedAt,
      guest: Boolean(submission?.guest_token ?? guestToken),
    });

    return NextResponse.json({
      ok: true,
      urls,
      expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
    });
  } catch (error) {
    const isConfig = error instanceof B2ConfigError;
    const message =
      isConfig
        ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
        : error instanceof Error
          ? error.message
          : "업로드 URL을 생성할 수 없습니다.";
    console.error("[Upload][multipart][presign] error", {
      submissionId,
      key,
      uploadId,
      raw: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: message },
      { status: isConfig ? 503 : 500 },
    );
  }
}
