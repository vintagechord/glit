import { NextResponse } from "next/server";

import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

/**
 * Supabase's legacy signed-upload URL does not bind the declared content
 * length. All current clients use the size-bound B2 upload endpoints, so keep
 * this old endpoint fail-closed instead of issuing an unmetered storage grant.
 */
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

  return NextResponse.json(
    {
      error:
        "이전 업로드 방식은 더 이상 지원하지 않습니다. 화면을 새로고침한 뒤 다시 시도해주세요.",
    },
    { status: 410 },
  );
}
