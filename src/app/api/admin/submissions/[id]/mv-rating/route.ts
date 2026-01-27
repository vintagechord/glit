import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isRatingCode } from "@/lib/mv-assets";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  rating: z.string().refine(isRatingCode, "유효하지 않은 등급 코드입니다."),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");

  if (!user || !isAdmin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const { id: submissionId } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "rating 값을 확인해주세요." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("submissions")
    .update({ mv_rating: parsed.data.rating })
    .eq("id", submissionId)
    .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error ? "등급을 저장하지 못했습니다." : "뮤직비디오 접수가 아닙니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, rating: parsed.data.rating });
}
