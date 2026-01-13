import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, presignPutUrl } from "@/lib/b2";
import { createServerSupabase } from "@/lib/supabase/server";

const schema = z.object({
  submissionId: z.string().uuid(),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().positive(),
  title: z.string().optional(),
  guestToken: z.string().min(8).optional(),
});

const MAX_SIZE_BYTES = 3.5 * 1024 * 1024 * 1024; // ~3.5GB safety margin

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const { filename, submissionId, mimeType, sizeBytes, guestToken, title } =
    parsed.data;

  if (sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "파일 용량이 허용 한도를 초과했습니다." },
      { status: 400 },
    );
  }

  try {
    if (!user && !guestToken) {
      return NextResponse.json(
        { error: "로그인 또는 게스트 토큰이 필요합니다." },
        { status: 401 },
      );
    }

    const objectKey = buildObjectKey({
      userId: user?.id ?? `guest-${guestToken}`,
      submissionId,
      title,
      filename,
    });

    const uploadUrl = await presignPutUrl({
      objectKey,
      contentType: mimeType,
    });

    console.info("[Upload][presign] ok", {
      submissionId,
      objectKey,
      sizeBytes,
      user: user?.id ?? null,
      guest: Boolean(guestToken),
    });

    return NextResponse.json({
      uploadUrl,
      objectKey,
      expiresIn: Number(process.env.B2_PRESIGN_EXPIRES_SECONDS ?? "900"),
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : "업로드 URL을 생성할 수 없습니다.";
    console.error("[Upload][presign] error", {
      submissionId,
      user: user?.id ?? null,
      guest: Boolean(guestToken),
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof B2ConfigError) {
      return NextResponse.json(
        { error: message },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
