import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isRatingCode } from "@/lib/mv-assets";
import { sendSubmissionUpdateNotificationById } from "@/lib/admin/submission-notifications";
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

  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const { id: submissionId } = await context.params;
  if (!z.string().uuid().safeParse(submissionId).success) {
    return NextResponse.json({ error: "유효하지 않은 접수 ID입니다." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "rating 값을 확인해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select("id, type, mv_desired_rating, result_status, status")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (submission.type !== "MV_DISTRIBUTION") {
    return NextResponse.json(
      { error: "온라인 업로드용 뮤직비디오 심의만 등급을 설정할 수 있습니다." },
      { status: 400 },
    );
  }

  const expectedResult = parsed.data.rating === "REJECT" ? "REJECTED" : "APPROVED";
  const completion = await completeMvReviewFlow(admin, submissionId, {
    actorUserId: user.id, rating: parsed.data.rating, resultStatus: expectedResult,
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

  if (!completion.changed) {
    return NextResponse.json({ ok: true, rating: parsed.data.rating, resultStatus: expectedResult, unchanged: true });
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/track");

  const notification = await sendSubmissionUpdateNotificationById({
    submissionId, changeKey: completion.changeKey, markResultNotified: true, headline: "뮤직비디오 심의 등급이 업데이트되었습니다.",
    summary: "신청 내역에서 확정된 심의 등급을 확인해주세요.", subject: "[onside] 뮤직비디오 심의 등급 안내",
  });
  return NextResponse.json({
    ok: true, warning: notification.warning,
    rating: parsed.data.rating,
    resultStatus: completion.resultStatus,
    stationCount: completion.stationCount,
  });
}
