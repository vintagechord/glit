import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { sendSubmissionBankRequestEmail } from "@/lib/email";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
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
  album_draft_group_id: string | null;
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
  const requestLimit = consumeRateLimit({
    namespace: "cart-bank-payment-ip",
    identifier: getRequestIdentifier(req.headers),
    limit: 20,
    windowMs: 15 * 60 * 1_000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "결제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }

  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  const body = await readBoundedJsonBody(req, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "결제할 신청서를 선택해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "결제할 신청서를 선택해주세요." },
      { status: 400 },
    );
  }

  const submissionIds = Array.from(new Set(parsed.data.submissionIds));
  const guestTokensBySubmissionId =
    parsed.data.guestTokensBySubmissionId ?? {};
  const guestTokens = Array.from(
    new Set(Object.values(guestTokensBySubmissionId)),
  );
  const admin = createAdminClient();
  let submissionQuery = admin
    .from("submissions")
    .select(
      "id, user_id, guest_token, type, title, artist_name, amount_krw, status, payment_status, album_draft_group_id, applicant_email, guest_email",
    )
    .in("id", submissionIds)
    .or("payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)");
  submissionQuery = user
    ? submissionQuery.eq("user_id", user.id)
    : submissionQuery
        .is("user_id", null)
        .in("guest_token", guestTokens);
  const { data, error } = await submissionQuery;

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

  const albumDraftGroupIds = Array.from(
    new Set(
      submissions
        .filter(
          (item) => item.type === "ALBUM" && item.album_draft_group_id,
        )
        .map((item) => item.album_draft_group_id as string),
    ),
  );
  if (albumDraftGroupIds.length > 0) {
    const { data: activeGroupRows, error: groupError } = await admin
      .from("submissions")
      .select("id, album_draft_group_id")
      .in("album_draft_group_id", albumDraftGroupIds)
      .in("status", ["DRAFT", "PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"])
      .or("payment_status.is.null,payment_status.neq.PAID");
    if (groupError) {
      console.error("[CartBank] album group load failed", groupError);
      return NextResponse.json(
        { error: "앨범 장바구니 묶음을 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    const requestedIdSet = new Set(submissionIds);
    if (
      (activeGroupRows ?? []).some(
        (row) => !requestedIdSet.has(String(row.id)),
      )
    ) {
      return NextResponse.json(
        {
          error:
            "함께 작성한 앨범은 묶음 전체의 접수를 완료한 뒤 함께 결제해주세요.",
        },
        { status: 409 },
      );
    }
  }

  const totalAmountKrw = submissions.reduce(
    (sum, item) => sum + Math.round(Number(item.amount_krw ?? 0)),
    0,
  );

  const { data: updatedRows, error: updateError } = await admin.rpc(
    "begin_submission_bank_payment",
    {
      p_submission_ids: submissionIds,
      p_user_id: user?.id ?? null,
    },
  );

  if (updateError || (updatedRows ?? []).length !== submissionIds.length) {
    console.error("[CartBank] update failed", updateError);
    const invalidAlbumPrice = updateError?.message?.includes(
      "ALBUM_PRICE_SNAPSHOT_INVALID",
    );
    const invalidAlbumDiscount = updateError?.message?.includes(
      "ALBUM_DISCOUNT_NOT_ELIGIBLE",
    );
    const incompleteAlbumGroup = updateError?.message?.includes(
      "ALBUM_GROUP_INCOMPLETE",
    );
    const conflict =
      invalidAlbumPrice ||
      invalidAlbumDiscount ||
      incompleteAlbumGroup ||
      (updateError?.code === "55000" &&
        (updateError.message?.includes("PAYMENT_ALREADY_IN_PROGRESS") ||
          updateError.message?.includes("SUBMISSION_NOT_PAYABLE")));
    return NextResponse.json(
      {
        error: invalidAlbumPrice
          ? "앨범 신청서의 결제 금액이 변경되었습니다. 신청서를 다시 저장해주세요."
          : invalidAlbumDiscount
            ? "추가 앨범 할인 결제에는 같은 패키지의 정가 앨범을 함께 선택하거나 먼저 결제해야 합니다."
            : incompleteAlbumGroup
              ? "함께 작성한 앨범은 묶음 전체를 선택해 결제해주세요."
            : conflict
              ? "이미 결제가 진행 중이거나 결제 대기 상태인 신청서가 포함되어 있습니다."
              : "무통장 입금 대기 상태로 변경하지 못했습니다.",
      },
      { status: conflict ? 409 : 500 },
    );
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
