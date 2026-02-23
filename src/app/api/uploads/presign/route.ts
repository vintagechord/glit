import { NextResponse } from "next/server";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, presignPutUrl } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createServerSupabase } from "@/lib/supabase/server";

const schema = z.object({
  submissionId: z.string().uuid(),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().positive(),
  title: z.string().optional(),
  guestToken: z.string().min(8).optional(),
  kind: z.enum(["audio", "video"]).optional(),
  scope: z
    .enum(["submission", "karaoke_request", "karaoke_recommendation"])
    .optional(),
});

const MAX_AUDIO_BYTES = 1 * 1024 * 1024 * 1024; // 1GB
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
const MAX_GENERIC_BYTES = 1 * 1024 * 1024 * 1024; // 1GB

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
  const scope = parsed.data.scope ?? "submission";
  const inferredKind = (() => {
    if (parsed.data.kind) return parsed.data.kind;
    const normalizedMime = (mimeType ?? "").toLowerCase();
    if (normalizedMime.startsWith("video/")) return "video" as const;
    if (normalizedMime.startsWith("audio/")) return "audio" as const;
    const normalizedName = filename.toLowerCase();
    if (normalizedName.match(/\.(mp4|mov|mkv|webm|avi|wmv|m4v|mpg|mpeg)$/)) {
      return "video" as const;
    }
    return "audio" as const;
  })();

  const maxSize =
    scope === "submission"
      ? inferredKind === "video"
        ? MAX_VIDEO_BYTES
        : MAX_AUDIO_BYTES
      : MAX_GENERIC_BYTES;
  if (sizeBytes > maxSize) {
    return NextResponse.json(
      {
        error:
          scope === "submission"
            ? inferredKind === "video"
              ? "뮤직비디오는 최대 4GB까지 업로드할 수 있습니다."
              : "음원 파일은 최대 1GB까지 업로드할 수 있습니다."
            : "파일 용량이 허용 한도를 초과했습니다.",
      },
      { status: 413 },
    );
  }

  try {
    let objectOwnerId: string | null = null;

    if (scope === "submission") {
      const { user: ownerUser, submission, error } = await ensureSubmissionOwner(
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
      objectOwnerId =
        submission?.user_id ??
        ownerUser?.id ??
        `guest-${guestToken ?? submission?.guest_token ?? "new"}`;
    } else if (scope === "karaoke_recommendation") {
      if (!user) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 },
        );
      }
      objectOwnerId = user.id;
    } else {
      if (!user && !guestToken) {
        return NextResponse.json(
          { error: "로그인 또는 게스트 토큰이 필요합니다." },
          { status: 401 },
        );
      }
      objectOwnerId = user?.id ?? `guest-${guestToken}`;
    }
    if (!objectOwnerId) {
      return NextResponse.json(
        { error: "업로드 사용자 정보를 확인할 수 없습니다." },
        { status: 401 },
      );
    }

    const objectKey = buildObjectKey({
      userId: objectOwnerId,
      submissionId,
      title: title?.trim() || scope.replace(/_/g, "-"),
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
      scope,
      user: user?.id ?? objectOwnerId ?? null,
      guest: Boolean(guestToken),
    });

    return NextResponse.json({
      uploadUrl,
      objectKey,
      scope,
      expiresIn: Number(process.env.B2_PRESIGN_EXPIRES_SECONDS ?? "900"),
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
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
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
