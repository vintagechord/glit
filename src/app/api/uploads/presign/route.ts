import { NextResponse } from "next/server";
import { z } from "zod";

import {
  B2ConfigError,
  buildObjectKey,
  getB2Config,
  presignPutUrl,
} from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";

const schema = z.object({
  submissionId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional(),
  sizeBytes: z.number().int().positive(),
  title: z.string().max(200).optional(),
  guestToken: z.string().min(8).max(120).optional(),
  kind: z.enum(["audio", "video"]).optional(),
  scope: z
    .enum(["submission", "karaoke_request", "karaoke_recommendation"])
    .optional(),
});

const MAX_GENERIC_BYTES = 512 * 1024 * 1024; // 512MB
const KARAOKE_UPLOAD_LIMIT = 10;
const KARAOKE_UPLOAD_WINDOW_MS = 60 * 60 * 1_000;

export async function POST(request: Request) {
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
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const { filename, submissionId, mimeType, sizeBytes, guestToken, title } =
    parsed.data;
  const scope = parsed.data.scope ?? "submission";
  // Applicant files go through /api/uploads/init (single PUT up to 128MB with
  // byte quotas) or the multipart grant flow. A 4GB presigned PUT here would
  // leave untracked objects that no cleanup ever finds, so only the karaoke
  // scopes remain.
  if (scope === "submission") {
    return NextResponse.json(
      { error: "이 업로드 방식은 더 이상 지원하지 않습니다. 페이지를 새로고침한 뒤 다시 시도해주세요." },
      { status: 410 },
    );
  }
  if (sizeBytes > MAX_GENERIC_BYTES) {
    return NextResponse.json(
      { error: "파일 용량이 허용 한도를 초과했습니다." },
      { status: 413 },
    );
  }

  try {
    let objectOwnerId: string | null = null;

    if (scope === "karaoke_recommendation") {
      if (!user) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 },
        );
      }
      objectOwnerId = user.id;
    } else {
      // Karaoke attachments are uploaded before a request row exists, so a
      // caller-provided UUID cannot prove guest ownership. Fail closed for
      // guests and bind authenticated uploads to the verified account.
      if (!user) {
        return NextResponse.json(
          { error: "비회원 첨부 파일은 지원하지 않습니다. 로그인 후 첨부해주세요." },
          { status: 401 },
        );
      }
      const karaokeLimit = consumeRateLimit({
        namespace: "upload-karaoke-request-user",
        identifier: user.id,
        limit: KARAOKE_UPLOAD_LIMIT,
        windowMs: KARAOKE_UPLOAD_WINDOW_MS,
      });
      if (!karaokeLimit.allowed) {
        return NextResponse.json(
          { error: "첨부 파일 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
          {
            status: 429,
            headers: { "Retry-After": String(karaokeLimit.retryAfterSeconds) },
          },
        );
      }
      objectOwnerId = user.id;
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
      contentLength: sizeBytes,
    });

    console.info("[Upload][presign] ok", {
      submissionIdHash: getStorageLogId(submissionId),
      objectKeyId: getStorageLogId(objectKey),
      sizeBytes,
      scope,
      userIdHash: getStorageLogId(user?.id ?? objectOwnerId),
      guest: Boolean(guestToken),
    });

    return NextResponse.json({
      uploadUrl,
      objectKey,
      scope,
      expiresIn: getB2Config().signExpiry,
    });
  } catch (error) {
    const message =
      error instanceof B2ConfigError
        ? "스토리지 설정 오류입니다. 관리자에게 문의해주세요."
        : "업로드 URL을 생성할 수 없습니다.";
    console.error("[Upload][presign] error", {
      submissionIdHash: getStorageLogId(submissionId),
      userIdHash: user?.id ? getStorageLogId(user.id) : null,
      guest: Boolean(guestToken),
      errorName: error instanceof Error ? error.name : "UnknownError",
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
