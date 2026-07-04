import { NextRequest, NextResponse } from "next/server";

import { createAttachmentResponseFromUrl } from "@/lib/download-response";
import {
  RATING_LABELS,
  isRatingCode,
  resolveRatingImageUrl,
  type RatingCode,
} from "@/lib/mv-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ensureAdmin = async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return { user, isAdmin };
};

const ratingFilenames: Record<RatingCode, string> = {
  ALL: "onside-mv-rating-all.png",
  "12": "onside-mv-rating-12.png",
  "15": "onside-mv-rating-15.png",
  "18": "onside-mv-rating-19.png",
  "19": "onside-mv-rating-19.png",
  REJECT: "onside-mv-rating-reject.png",
};

export async function GET(req: NextRequest) {
  const { user, isAdmin } = await ensureAdmin();
  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const rating = new URL(req.url).searchParams.get("rating");
  if (!isRatingCode(rating)) {
    return NextResponse.json({ error: "등급 값을 확인해주세요." }, { status: 400 });
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
    console.error("[admin][mv-rating-assets][download] failed", {
      rating,
      label: RATING_LABELS[rating],
      error,
    });
    return NextResponse.json(
      { error: "등급 이미지를 다운로드하지 못했습니다." },
      { status: 500 },
    );
  }
}
