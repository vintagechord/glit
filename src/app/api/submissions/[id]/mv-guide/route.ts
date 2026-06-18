import { NextRequest, NextResponse } from "next/server";

import { getGuideSignedUrl } from "@/lib/mv-assets";
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
  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (submission.type !== "MV_DISTRIBUTION") {
    return NextResponse.json(
      { error: "온라인 업로드용 뮤직비디오 심의만 가이드를 다운로드할 수 있습니다." },
      { status: 404 },
    );
  }
  const hasResultSignal = Boolean(
    submission.result_status ||
      submission.result_notified_at ||
      (submission.status && ["RESULT_READY", "COMPLETED"].includes(submission.status)),
  );
  if (!hasResultSignal) {
    return NextResponse.json({ error: "아직 결과가 준비되지 않았습니다." }, { status: 403 });
  }

  try {
    const urlSigned = await getGuideSignedUrl();
    return NextResponse.json({ url: urlSigned });
  } catch (error) {
    console.error("[mv-guide] failed to presign guide", {
      submissionId,
      error,
    });
    return NextResponse.json({ error: "가이드 링크를 생성하지 못했습니다." }, { status: 500 });
  }
}
