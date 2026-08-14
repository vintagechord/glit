import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { sendSubmissionBankRequestEmail } from "@/lib/email";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  submissionIds: z.array(z.string().uuid()).min(1).max(100),
  guestTokensBySubmissionId: z
    .record(z.string().uuid(), z.string().min(8).max(120))
    .optional(),
});

type CartBankSubmission = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  type: string | null;
  title: string | null;
  artist_name: string | null;
  amount_krw: number | null;
  status: string | null;
  payment_status: string | null;
  applicant_email: string | null;
  guest_email: string | null;
};

const cartStatuses = new Set(["SUBMITTED", "WAITING_PAYMENT"]);

const collectEmails = (...values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim().toLowerCase() ?? "")
        .filter(Boolean),
    ),
  );

const getKind = (type?: string | null): "ALBUM" | "MV" =>
  type === "ALBUM" ? "ALBUM" : "MV";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "결제할 신청서를 선택해주세요." },
      { status: 400 },
    );
  }

  const submissionIds = Array.from(new Set(parsed.data.submissionIds));
  const guestTokensBySubmissionId =
    parsed.data.guestTokensBySubmissionId ?? {};
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select(
      "id, user_id, guest_token, type, title, artist_name, amount_krw, status, payment_status, applicant_email, guest_email",
    )
    .in("id", submissionIds)
    .or("payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)");

  if (error) {
    console.error("[CartBank] load failed", error);
    return NextResponse.json(
      { error: "신청서 정보를 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  const submissions = ((data ?? []) as unknown[]).map(
    (row) => row as CartBankSubmission,
  );
  if (submissions.length !== submissionIds.length) {
    return NextResponse.json(
      { error: "결제할 수 없는 신청서가 포함되어 있습니다." },
      { status: 403 },
    );
  }

  const hasInvalidOwner = submissions.some((submission) => {
    if (user) return submission.user_id !== user.id;
    return !(
      !submission.user_id &&
      submission.guest_token &&
      guestTokensBySubmissionId[submission.id] === submission.guest_token
    );
  });
  if (hasInvalidOwner) {
    return NextResponse.json(
      { error: "결제할 신청서의 소유권을 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  const invalidSubmission = submissions.find((item) => {
    const amount = Math.round(Number(item.amount_krw ?? 0));
    return (
      item.payment_status === "PAID" ||
      !cartStatuses.has(String(item.status ?? "")) ||
      !Number.isFinite(amount) ||
      amount <= 0
    );
  });
  if (invalidSubmission) {
    return NextResponse.json(
      { error: "작성 완료된 미결제 신청서만 결제할 수 있습니다." },
      { status: 409 },
    );
  }

  const totalAmountKrw = submissions.reduce(
    (sum, item) => sum + Math.round(Number(item.amount_krw ?? 0)),
    0,
  );

  let updateQuery = admin
    .from("submissions")
    .update({
      payment_method: "BANK",
      payment_status: "PAYMENT_PENDING",
      status: "WAITING_PAYMENT",
    })
    .in("id", submissionIds)
    .in("status", ["SUBMITTED", "WAITING_PAYMENT"])
    .neq("payment_status", "PAID");
  updateQuery = user
    ? updateQuery.eq("user_id", user.id)
    : updateQuery.is("user_id", null);
  const { data: updatedRows, error: updateError } = await updateQuery.select(
    "id",
  );

  if (updateError || (updatedRows ?? []).length !== submissionIds.length) {
    console.error("[CartBank] update failed", updateError);
    return NextResponse.json(
      { error: "무통장 입금 대기 상태로 변경하지 못했습니다." },
      { status: 500 },
    );
  }

  const eventRows = submissionIds.map((submissionId) => ({
    submission_id: submissionId,
    actor_user_id: user?.id ?? null,
    event_type: "PAYMENT_UPDATE",
    message: "장바구니에서 무통장 입금 대기 상태로 변경되었습니다.",
  }));
  const { error: eventError } = await admin
    .from("submission_events")
    .insert(eventRows);
  if (eventError) {
    console.warn("[CartBank] event insert failed", eventError);
  }

  const baseUrl = getBaseUrl(req);
  await Promise.all(
    submissions.map(async (submission) => {
      const recipients = collectEmails(
        user?.email,
        submission.applicant_email,
        submission.guest_email,
      );
      if (recipients.length === 0) return;
      await Promise.all(
        recipients.map(async (email) => {
          const result = await sendSubmissionBankRequestEmail({
            email,
            title: submission.title || "제목 미입력",
            artist: submission.artist_name,
            kind: getKind(submission.type),
            amountKrw: Math.round(Number(submission.amount_krw ?? 0)),
            bankDepositorName: null,
            link: buildUrl(
              submission.guest_token
                ? `/track/${encodeURIComponent(submission.guest_token)}`
                : `/dashboard/submissions/${submission.id}`,
              baseUrl,
            ),
            siteLink: buildUrl("/", baseUrl),
          });
          if (!result.ok && !result.skipped) {
            console.warn("[CartBank] bank email failed", {
              submissionId: submission.id,
              email,
              message: result.message,
            });
          }
        }),
      );
    }),
  );

  revalidatePath("/dashboard/cart");
  revalidatePath("/mypage/cart");
  revalidatePath("/en/dashboard/cart");
  revalidatePath("/en/mypage/cart");
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/en/dashboard");
  revalidatePath("/en/mypage");
  if (user) {
    clearDashboardStatusCache(user.id);
  }

  return NextResponse.json({
    ok: true,
    count: submissionIds.length,
    totalAmountKrw,
  });
}
