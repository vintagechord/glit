import { NextRequest, NextResponse } from "next/server";

import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { presignGetUrl } from "@/lib/b2";

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
  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }

  const key = submission.mv_certificate_object_key?.trim();
  if (!key) {
    return NextResponse.json({ error: "필증이 등록되지 않았습니다." }, { status: 404 });
  }

  try {
    const urlSigned = await presignGetUrl(key, 60 * 10);
    return NextResponse.json({
      url: urlSigned,
      filename: submission.mv_certificate_filename,
      mimeType: submission.mv_certificate_mime_type,
      sizeBytes: submission.mv_certificate_size_bytes,
    });
  } catch (err) {
    return NextResponse.json({ error: "필증 링크를 생성하지 못했습니다." }, { status: 500 });
  }
}
