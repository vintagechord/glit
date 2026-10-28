import { createAdminClient } from "@/lib/supabase/admin";
import { getMemberNotificationEmail } from "@/lib/member-notification-email";
import { sendAdminSubmissionReceiptEmail, sendPaymentCompletedEmail, sendSubmissionUpdateEmail, type OrderEmailItem } from "@/lib/email";
import type { EmailSendResult } from "@/lib/email-transport";
import { isEmailRecipient } from "@/lib/email-config";
import { formatCurrency } from "@/lib/format";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { buildUrl, getBaseUrl } from "@/lib/url";

type OrderSummary = {
  id: string;
  paymentMethod: "CARD" | "BANK" | "PAYPAL";
  amountLabel: string;
  paidAt: string | null;
  items: OrderEmailItem[];
  awaitingEmailMaterials: boolean;
};

/** The order snapshot taken at checkout; a missing or unreadable order only
 * downgrades the receipt to the per-application notice. */
async function loadOrderSummary(db: ReturnType<typeof createAdminClient>, orderId: string): Promise<OrderSummary | null> {
  const { data: order, error } = await db.from("submission_orders")
    .select("id,payment_method,amount_krw,amount,currency,paid_at").eq("id", orderId).maybeSingle();
  if (error || !order) return null;
  const { data: items, error: itemsError } = await db.from("submission_order_items")
    .select("submission_ref,title,artist_name,type,amount_krw").eq("order_id", orderId);
  if (itemsError || !items?.length) return null;
  const { data: flags } = await db.from("submissions").select("id,files_submitted_by_email")
    .in("id", items.map((item: { submission_ref: string }) => item.submission_ref));
  const amountKrw = Number(order.amount_krw);
  const amount = Number(order.amount);
  return {
    id: order.id,
    paymentMethod: order.payment_method === "BANK" ? "BANK" : order.payment_method === "PAYPAL" ? "PAYPAL" : "CARD",
    amountLabel: order.currency === "KRW" || !Number.isFinite(amount)
      ? `${formatCurrency(Number.isFinite(amountKrw) ? amountKrw : 0)}원`
      : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)} ${order.currency}`,
    paidAt: order.paid_at ?? null,
    items: items.map((item: { title: string | null; artist_name: string | null; type: string | null; amount_krw: number | null }) => ({
      title: item.title, artist: item.artist_name, kind: item.type?.startsWith("MV") ? "MV" : "ALBUM", amountKrw: item.amount_krw,
    })),
    awaitingEmailMaterials: (flags ?? []).some((row: { files_submitted_by_email?: boolean | null }) => row.files_submitted_by_email === true),
  };
}

export type PaidSubmissionNotificationOutcome = {
  /** True once each applicable notification has a durable outbox receipt. */
  recorded: boolean;
  eligible: boolean;
  customer: EmailSendResult | null;
  admin: EmailSendResult | null;
  warning?: string;
};

const failure = (): EmailSendResult => ({ ok: false, reason: "delivery" });
const isRecorded = (result: EmailSendResult | null) => Boolean(result?.outboxId || result?.ok);

/** Call only after payment approval commits. This also verifies PAID itself.
 * The callback and durable payment-event worker share keys; retrying one never
 * creates a second accepted receipt. Customer and administrator delivery are
 * independent, and no review result notification is sent through this path.
 */
export async function sendPaidSubmissionNotificationsById(input: {
  submissionId: string;
  paymentKey: string;
  notifyKakao?: boolean;
}): Promise<PaidSubmissionNotificationOutcome> {
  const outcome: PaidSubmissionNotificationOutcome = { recorded: false, eligible: false, customer: null, admin: null };
  try {
    const db = createAdminClient();
    const { data: submission, error } = await db.from("submissions")
      .select("id,user_id,guest_token,guest_email,guest_phone,applicant_email,applicant_phone,title,artist_name,type,amount_krw,payment_status,current_order_id")
      .eq("id", input.submissionId).maybeSingle();
    if (error || !submission) return { ...outcome, warning: "결제는 저장되었지만 접수 알림에 필요한 정보를 확인하지 못했습니다." };
    if (submission.payment_status !== "PAID") return { ...outcome, recorded: true };
    outcome.eligible = true;
    const { data: event, error: eventError } = await db.from("paid_submission_notification_events")
      .select("payment_key,enqueued_at").eq("submission_id", submission.id).maybeSingle();
    // The transition event is authoritative across callback, bank confirmation
    // and worker paths. A completed event outlives retained outbox bodies, so
    // old callbacks cannot recreate previously delivered receipts after cleanup.
    if (eventError) return { ...outcome, warning: "결제는 저장되었습니다. 접수 알림 기록을 확인한 뒤 다시 시도할 예정입니다." };
    if (event?.enqueued_at) return { ...outcome, recorded: true };
    if (event && (typeof event.payment_key !== "string" || !event.payment_key.trim())) {
      return { ...outcome, warning: "결제는 저장되었습니다. 접수 알림 등록 정보를 확인해주세요." };
    }
    const paymentKey = event?.payment_key ?? input.paymentKey;
    const baseUrl = getBaseUrl();
    const kind = submission.type?.startsWith("MV") ? "MV" : "ALBUM";
    const guestAccess = !submission.user_id && submission.guest_token?.length >= 8;
    const link = buildUrl(guestAccess
      ? `/track/${encodeURIComponent(submission.guest_token)}`
      : `/dashboard/submissions/${submission.id}`, baseUrl);
    const order = typeof submission.current_order_id === "string" && submission.current_order_id
      ? await loadOrderSummary(db, submission.current_order_id).catch(() => null)
      : null;
    let customerLookupFailed = false;
    // Begin the admin notice independently so customer account lookup or an
    // invalid/missing customer address cannot suppress the operations notice.
    const adminPromise = sendAdminSubmissionReceiptEmail({
      submissionId: submission.id, title: submission.title ?? "제목 미입력",
      artist: submission.artist_name, submissionType: submission.type ?? "ALBUM",
      amountKrw: submission.amount_krw,
      link: buildUrl(`/admin/submissions/detail?id=${encodeURIComponent(submission.id)}`, baseUrl),
      idempotencyKey: `admin-submission-received:${submission.id}`,
    }).catch(failure);
    const customerPromise = (async () => {
      let email: string | null = null;
      let usesApplicationContact = false;
      if (submission.user_id) {
        const member = await db.auth.admin.getUserById(submission.user_id);
        if (member.error) customerLookupFailed = true;
        else {
          email = getMemberNotificationEmail(member.data.user, submission.applicant_email);
          usesApplicationContact = Boolean(email && !member.data.user?.email?.trim());
        }
      } else email = submission.guest_email || submission.applicant_email || null;
      const recipient = email?.trim().toLowerCase() ?? "";
      if (!isEmailRecipient(recipient)) return null;
      // A declared application contact may only see that application's details.
      if (order && !usesApplicationContact) {
        // One receipt per order: every application in the same order shares
        // this key, so the outbox stores the summary message exactly once.
        return sendPaymentCompletedEmail({
          email: recipient, orderId: order.id, paymentMethod: order.paymentMethod, paidAt: order.paidAt,
          amountLabel: order.amountLabel, items: order.items, awaitingEmailMaterials: order.awaitingEmailMaterials,
          link, ordersLink: guestAccess ? undefined : buildUrl(`/mypage/orders?focus=${submission.id}`, baseUrl),
          idempotencyKey: `payment-approved:${paymentKey}:${order.id}:${recipient}`,
          submissionId: submission.id,
          guestToken: submission.user_id ? undefined : submission.guest_token ?? undefined,
        });
      }
      return sendSubmissionUpdateEmail({
        email: recipient, title: submission.title ?? "제목 미입력", artist: submission.artist_name,
        kind, headline: "결제가 완료되었습니다.",
        summary: "결제 완료로 처리되었습니다. 심의는 접수예정 단계에서 자료 확인 후 방송사·기관 접수를 진행합니다. 미제출 자료가 있으면 신청 내역의 안내에 따라 제출해주세요.",
        link, subject: "[onside] 결제 완료 및 심의 접수 안내",
        // Preserve the pre-existing card receipt key on callback replays.
        idempotencyKey: `payment-approved:${paymentKey}:${submission.id}:${recipient}`,
        submissionId: submission.id,
        guestToken: submission.user_id ? undefined : submission.guest_token ?? undefined,
      });
    })().catch(() => { customerLookupFailed = true; return failure(); });
    [outcome.admin, outcome.customer] = await Promise.all([adminPromise, customerPromise]);
    outcome.recorded = isRecorded(outcome.admin) && !customerLookupFailed && (outcome.customer === null || isRecorded(outcome.customer));
    if (!outcome.recorded) outcome.warning = "결제는 저장되었습니다. 접수 알림 등록을 다시 시도할 예정입니다. 이메일 발송 내역을 확인해주세요.";
    else if ([outcome.customer, outcome.admin].some(result => result?.status === "uncertain")) {
      outcome.warning = "결제는 저장되었습니다. 접수 알림의 메일 서버 접수 여부를 확인해야 합니다. 중복 발송을 막기 위해 자동 재발송을 보류했습니다. 이메일 발송 내역을 확인해주세요.";
    } else if ([outcome.customer, outcome.admin].some(result => result && ["failed", "expired"].includes(result.status ?? ""))) {
      outcome.warning = "결제는 저장되었지만 접수 알림 발송을 완료하지 못했습니다. 이메일 발송 내역에서 실패·만료 사유를 확인해주세요.";
    } else if ([outcome.customer, outcome.admin].some(result => result && !result.ok)) {
      outcome.warning = "결제는 저장되었으며 접수 알림이 발송 대기열에 등록되었습니다. 이메일 발송 내역에서 상태를 확인해주세요.";
    }
    if (input.notifyKakao) {
      let phone = submission.applicant_phone ?? submission.guest_phone;
      if (!phone && submission.user_id) {
        const profile = await Promise.resolve(db.from("profiles").select("phone").eq("user_id", submission.user_id).maybeSingle()).catch(() => ({ data: null }));
        phone = profile.data?.phone ?? null;
      }
      await sendKakaoOfficialNotification({ phone, title: "결제가 완료되었습니다.",
        message: `${submission.title ?? "제목 미입력"} 결제를 확인했습니다. 자료 확인 후 방송사·기관 접수를 진행합니다.`, link }).catch(() => undefined);
    }
    return outcome;
  } catch {
    return { ...outcome, warning: "결제는 저장되었습니다. 접수 알림을 완료하지 못해 다시 시도할 예정입니다." };
  }
}
