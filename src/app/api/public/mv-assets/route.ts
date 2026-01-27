import { NextResponse } from "next/server";

import { getGuideSignedUrl, getRatingSignedUrl, RATING_IMAGE_MAP } from "@/lib/mv-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await Promise.all(
      (Object.keys(RATING_IMAGE_MAP) as Array<keyof typeof RATING_IMAGE_MAP>).map(
        async (code) => {
          const url = await getRatingSignedUrl(code);
          return [code, url] as const;
        },
      ),
    );
    const guide = await getGuideSignedUrl();
    return NextResponse.json({
      ratingImages: Object.fromEntries(entries),
      guide,
    });
  } catch (error) {
    console.error("[mv-assets] failed", error);
    return NextResponse.json({ error: "자산을 불러오지 못했습니다." }, { status: 500 });
  }
}
