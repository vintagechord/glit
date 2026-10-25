import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isRatingCode } from "@/lib/mv-assets";
import { sendOnlineMvResultNotificationById } from "@/lib/admin/submission-notifications";
import { saveManagedOnlineReview } from "@/lib/admin/review-management";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  rating: z.string().refine(isRatingCode, "유효하지 않은 등급 코드입니다."),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
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
    return NextResponse.json({ error: "등급과 최신 변경 시각을 확인해주세요." }, { status: 400 });
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

  const rating = parsed.data.rating === "18" ? "19" : parsed.data.rating;
  const completion = await saveManagedOnlineReview(admin, {
    actorUserId: user.id, submissionId, rating, expectedUpdatedAt: parsed.data.expectedUpdatedAt,
  });
  if (!completion.ok) {
    const status = completion.errorCode === "CONFLICT" ? 409 : completion.errorCode === "FORBIDDEN" ? 403 : completion.errorCode === "INVALID" ? 400 : 500;
    return NextResponse.json({ error: completion.error }, { status });
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/track");

  const notification = await sendOnlineMvResultNotificationById({ submissionId });
  return NextResponse.json({
    ok: true, warning: notification.warning, pendingAssets: notification.pendingAssets,
    deliveredCount: notification.deliveredCount, queuedCount: notification.queuedCount ?? 0,
    rating, resultStatus: completion.resultStatus, unchanged: !completion.changed,
  });
}
