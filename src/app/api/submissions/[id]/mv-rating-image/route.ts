import { NextRequest, NextResponse } from "next/server";

import { createAttachmentResponseFromUrl } from "@/lib/download-response";
import { isRatingCode, resolveRatingImageUrl, type RatingCode } from "@/lib/mv-assets";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RatingFields = {
  type?: string | null;
  mv_desired_rating?: string | null;
  result_status?: string | null;
  result_notified_at?: string | null;
  status?: string | null;
};

const ratingFilenames: Record<RatingCode, string> = {
  ALL: "onside-mv-rating-all.png",
  "12": "onside-mv-rating-12.png",
  "15": "onside-mv-rating-15.png",
  "18": "onside-mv-rating-19.png",
  "19": "onside-mv-rating-19.png",
  REJECT: "onside-mv-rating-reject.png",
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: submissionId } = await context.params;
  const guestToken = req.headers.get("x-submission-guest-token") || undefined;

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
      { error: "온라인 업로드용 뮤직비디오 심의만 등급표를 다운로드할 수 있습니다." },
      { status: 404 },
    );
  }

  const fields = submission as RatingFields;
  const hasResultSignal = Boolean(
    fields.result_status ||
      fields.result_notified_at ||
      (fields.status && ["RESULT_READY", "COMPLETED"].includes(fields.status)),
  );
  if (!hasResultSignal) {
    return NextResponse.json({ error: "아직 결과가 준비되지 않았습니다." }, { status: 403 });
  }

  const rating = fields.mv_desired_rating ?? null;
  if (!isRatingCode(rating)) {
    return NextResponse.json({ error: "등급이 설정되지 않았습니다." }, { status: 404 });
  }
  try {
    const admin = createAdminClient();
    const ratingAsset = await resolveRatingImageUrl({
      rating,
      db: admin,
      baseUrl: getBaseUrl(req),
    });
    return await createAttachmentResponseFromUrl({
      url: ratingAsset.url,
      filename: ratingFilenames[rating],
      fallbackContentType: "image/png",
    });
  } catch (error) {
    console.error("[mv-rating-image] failed to presign rating image", {
      submissionId,
      rating,
      error,
    });
    return NextResponse.json({ error: "이미지 링크를 생성하지 못했습니다." }, { status: 500 });
  }
}
