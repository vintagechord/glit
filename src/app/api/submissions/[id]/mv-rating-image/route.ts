import { NextRequest, NextResponse } from "next/server";

import { getRatingObjectKey, isRatingCode } from "@/lib/mv-assets";
import { presignGetUrl } from "@/lib/b2";
import { ensureSubmissionOwner } from "@/lib/payments/submission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: submissionId } = await context.params;
  const url = new URL(req.url);
  const guestToken = url.searchParams.get("guestToken") || undefined;

  const { submission, error } = await ensureSubmissionOwner(submissionId, guestToken);
  if (error === "UNAUTHORIZED") {
    return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
  }
  if (error === "NOT_FOUND") {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (error === "FORBIDDEN") {
    return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
  }

  const rating = (submission as any)?.mv_desired_rating ?? null;
  if (!isRatingCode(rating)) {
    return NextResponse.json({ error: "등급이 설정되지 않았습니다." }, { status: 404 });
  }
  const objectKey = getRatingObjectKey(rating);
  if (!objectKey) {
    return NextResponse.json({ error: "등급 이미지를 찾을 수 없습니다." }, { status: 404 });
  }
  try {
    const urlSigned = await presignGetUrl(objectKey, 60 * 10);
    return NextResponse.json({ url: urlSigned, rating });
  } catch (err) {
    return NextResponse.json({ error: "이미지 링크를 생성하지 못했습니다." }, { status: 500 });
  }
}
