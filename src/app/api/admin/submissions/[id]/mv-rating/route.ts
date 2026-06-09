import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isRatingCode } from "@/lib/mv-assets";
import { completeMvReviewFlow } from "@/lib/admin/mv-review-flow";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();
  const completion = await completeMvReviewFlow(admin, submissionId, {
    rating: parsed.data.rating,
  });

  console.info("[admin][mv-rating] update", {
    submissionId,
    rating: parsed.data.rating,
    completed: completion.completed,
    stationCount: completion.stationCount,
    error: completion.error,
  });

  if (completion.error) {
    const status = completion.error.includes("찾을 수 없습니다") ? 404 : 500;
    return NextResponse.json({ error: completion.error }, { status });
  }
  if (!completion.completed) {
    return NextResponse.json(
      { error: "뮤직비디오 접수를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/track");

  return NextResponse.json({
    ok: true,
    rating: parsed.data.rating,
    resultStatus: completion.resultStatus,
    stationCount: completion.stationCount,
  });
}
