import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { resolveMemberNotificationEmail } from "@/lib/member-notification-email";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { sendOrderBankTransferEmail, sendSubmissionUpdateEmail } from "@/lib/email";
import { runAfterResponse } from "@/lib/next/after-response";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateReleasedAlbumPaymentFiles } from "@/lib/submission-payment-files";
import { validateMvPaymentStations } from "@/lib/submission-payment-stations";
import { validateAlbumPaymentPricing } from "@/lib/submission-payment-pricing";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { orderGuestTokensSchema } from "@/lib/submission-orders-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  submissionIds: z.array(z.string().uuid()).min(1).max(100),
  guestTokensBySubmissionId: orderGuestTokensSchema.optional(),
}).strict();

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
  payment_method: string | null;
  album_draft_group_id: string | null;
  current_order_id: string | null;
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
  const origin = req.headers.get("origin");
  if ((origin && origin !== new URL(req.url).origin && origin !== getBaseUrl()) || req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "같은 사이트에서 다시 요청해주세요." }, { status: 403 });
  }
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
      "id, user_id, guest_token, type, title, artist_name, amount_krw, status, payment_status, payment_method, current_order_id, album_draft_group_id, applicant_email, guest_email",
    )
    .in("id", submissionIds);
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

  let submissions = ((data ?? []) as unknown[]).map(
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

  const totalAmountKrw = submissions.reduce((sum, item) => sum + Math.round(Number(item.amount_krw ?? 0)), 0);
  const isExistingBankRequest = submissions.every(item =>
    item.payment_status === "PAYMENT_PENDING" && item.payment_method === "BANK" &&
    item.status === "WAITING_PAYMENT" && Boolean(item.current_order_id) &&
    Number.isFinite(Number(item.amount_krw)) && Number(item.amount_krw) > 0,
  );
  if (!isExistingBankRequest) {
    const invalidSubmission = submissions.find((item) => {
      const amount = Math.round(Number(item.amount_krw ?? 0));
      return (
        (item.payment_status !== null && item.payment_status !== "UNPAID") ||
        Boolean(item.current_order_id) ||
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
    const pricingError = await validateAlbumPaymentPricing(admin, submissionIds);
    if (pricingError) {
      return NextResponse.json({ error: pricingError }, { status: 409 });
    }
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

    const mediaError = await validateReleasedAlbumPaymentFiles(admin, submissionIds);
    if (mediaError) {
      return NextResponse.json({ error: mediaError }, { status: 409 });
    }
    const stationError = await validateMvPaymentStations(admin, submissionIds);
    if (stationError) {
      return NextResponse.json({ error: stationError }, { status: 409 });
    }

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
        updateError?.code === "55000";
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
  }

  // The begin RPC returns submission IDs, not its newly created checkout ID.
  // Reload before enqueueing so initial delivery and later repairs use the
  // same order-specific key, including after a cart is reopened and reordered.
  const { data: refreshedRows, error: refreshError } = await admin.from("submissions")
    .select("id, user_id, guest_token, type, title, artist_name, amount_krw, status, payment_status, payment_method, current_order_id, album_draft_group_id, applicant_email, guest_email")
    .in("id", submissionIds);
  if (refreshError || !refreshedRows || refreshedRows.length !== submissionIds.length) {
    return NextResponse.json({ error: "입금 요청은 저장되었지만 안내를 준비하지 못했습니다. 같은 주문으로 다시 요청해주세요." }, { status: 503 });
  }
  const refreshed = refreshedRows as unknown as CartBankSubmission[];
  if (refreshed.some(item => item.payment_status !== "PAYMENT_PENDING" || item.payment_method !== "BANK" ||
      item.status !== "WAITING_PAYMENT" || !item.current_order_id ||
      (user ? item.user_id !== user.id : Boolean(item.user_id) || guestTokensBySubmissionId[item.id] !== item.guest_token))) {
    return NextResponse.json({ error: "입금 대기 중인 같은 소유자의 주문만 다시 요청할 수 있습니다." }, { status: 409 });
  }
  submissions = refreshed;
  const orderIds = Array.from(new Set(submissions.map(item => item.current_order_id as string)));
  const [orders, items] = await Promise.all([
    admin.from("submission_orders").select("id, user_id, payment_method, status").in("id", orderIds),
    admin.from("submission_order_items").select("order_id, submission_ref").in("order_id", orderIds),
  ]);
  if (orders.error || items.error) {
    return NextResponse.json({ error: "입금 주문을 확인하지 못했습니다. 잠시 후 다시 요청해주세요." }, { status: 503 });
  }
  const requested = new Set(submissionIds);
  const orderBySubmission = new Map(submissions.map(item => [item.id, item.current_order_id]));
  if (orders.data?.length !== orderIds.length || orders.data.some(order => order.user_id !== (user?.id ?? null) || order.payment_method !== "BANK" || order.status !== "BANK_PENDING") ||
      items.data?.length !== submissionIds.length || items.data.some(item => !requested.has(item.submission_ref) || orderBySubmission.get(item.submission_ref) !== item.order_id)) {
    return NextResponse.json({ error: "입금 대기 주문의 신청서 전체를 선택해주세요." }, { status: 409 });
  }

  const baseUrl = getBaseUrl(req);
  const submissionsByOrder = new Map<string, CartBankSubmission[]>();
  for (const submission of submissions) {
    const orderId = submission.current_order_id as string;
    submissionsByOrder.set(orderId, [...(submissionsByOrder.get(orderId) ?? []), submission]);
  }
  // Send after the stored order's response. Application contacts receive only
  // their own details; account and guest recipients retain the order summary.
  // Unsent rows stay in the durable outbox for the scheduled worker.
  await runAfterResponse(async () => {
    await Promise.all(Array.from(submissionsByOrder, async ([orderId, orderSubmissions]) => {
      if (user && !user.email?.trim()) {
        await Promise.all(orderSubmissions.map(async (submission) => {
          const email = await resolveMemberNotificationEmail(admin, user, submission.applicant_email);
          if (!email) return;
          const result = await sendSubmissionUpdateEmail({
            email,
            title: submission.title ?? "제목 미입력",
            artist: submission.artist_name,
            kind: getKind(submission.type),
            headline: "입금 요청이 접수되었습니다.",
            summary: "입금 계좌와 주문 전체 금액은 로그인 후 마이페이지의 주문 내역에서 확인해주세요.",
            subject: "[onside] 무통장 입금 요청 접수 안내",
            link: buildUrl(`/mypage/orders?focus=${submission.id}`, baseUrl),
            idempotencyKey: `bank-request:${orderId}:${email}:${submission.id}`,
            submissionId: submission.id,
          });
          if (!result.ok && !result.skipped) {
            console.warn("[CartBank] bank email failed", { orderId, submissionId: submission.id, message: result.message });
          }
        }));
        return;
      }
      const recipients = collectEmails(...await Promise.all(orderSubmissions.map((submission) =>
        submission.user_id ? resolveMemberNotificationEmail(admin, user, submission.applicant_email) : submission.guest_email || submission.applicant_email)));
      if (recipients.length === 0) return;
      const first = orderSubmissions[0];
      const link = buildUrl(
        !first.user_id && first.guest_token
          ? `/track/${encodeURIComponent(first.guest_token)}`
          : `/mypage/orders?focus=${first.id}`,
        baseUrl,
      );
      const items = orderSubmissions.map((submission) => ({
        title: submission.title,
        artist: submission.artist_name,
        kind: getKind(submission.type),
        amountKrw: Math.round(Number(submission.amount_krw ?? 0)),
      }));
      const orderTotalKrw = items.reduce((sum, item) => sum + item.amountKrw, 0);
      await Promise.all(recipients.map(async (email) => {
        const result = await sendOrderBankTransferEmail({
          email,
          idempotencyKey: `bank-request:${orderId}:${email}`,
          orderId,
          items,
          totalAmountKrw: orderTotalKrw,
          link,
          siteLink: buildUrl("/", baseUrl),
        });
        if (!result.ok && !result.skipped) {
          console.warn("[CartBank] bank email failed", { orderId, message: result.message });
        }
      }));
    }));
  });

  revalidatePath("/dashboard/cart");
  revalidatePath("/mypage/cart");
  revalidatePath("/en/dashboard/cart");
  revalidatePath("/en/mypage/cart");
  revalidatePath("/dashboard/orders");
  revalidatePath("/mypage/orders");
  revalidatePath("/en/dashboard/orders");
  revalidatePath("/en/mypage/orders");
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
