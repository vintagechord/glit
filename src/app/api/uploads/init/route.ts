import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

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
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !guestToken) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: submission } = await admin
      .from("submissions")
      .select("id, user_id, guest_token")
      .eq("id", submissionId)
      .maybeSingle();

    const submissionGuestToken =
      typeof submission?.guest_token === "string" && submission.guest_token.length > 0
        ? submission.guest_token
        : null;

    if (submission) {
      const isOwner =
        (submission.user_id && submission.user_id === user?.id) ||
        (!submission.user_id && submissionGuestToken && submissionGuestToken === guestToken);
      if (!isOwner) {
        return NextResponse.json(
          { error: "접수에 대한 권한이 없습니다." },
          { status: user ? 403 : 401 },
        );
      }
    }

    const { client, bucket } = getB2Config();
    const key = buildObjectKey({
      userId: submission?.user_id ?? user?.id ?? `guest-${guestToken ?? submissionGuestToken ?? "new"}`,
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
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 URL을 생성할 수 없습니다.";
    console.error("[Upload][init] error", {
      submissionId,
      kind,
      sizeBytes,
      user: null,
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
