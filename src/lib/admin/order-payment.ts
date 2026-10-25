import type { createAdminClient } from "@/lib/supabase/admin";
import type { ReviewStatus } from "@/constants/review-status";

/** Payment confirms funds; the review team still has to check the materials.
 * Reconfirming payment must never reset an existing review or result. */
export function statusAfterPaymentConfirmation(currentStatus: ReviewStatus): ReviewStatus {
  return ["DRAFT", "WAITING_PAYMENT", "SUBMITTED"].includes(currentStatus)
    ? "PRE_REVIEW"
    : currentStatus;
}

/** A linked order owns payment state for its entire item group. Admin review
 * edits may update a paid submission's review stage, but cannot rewrite money
 * state independently or mark a card/PayPal attempt as a bank deposit. */
export async function confirmLinkedOrderPayment(
  db: Pick<ReturnType<typeof createAdminClient>, "from" | "rpc">,
  input: { orderId: string | null; currentPaymentStatus: string | null; nextPaymentStatus: string; actorUserId: string; adminMemo?: string | null },
): Promise<{ error?: string; confirmedIds?: string[]; refundedIds?: string[] }> {
  if (!input.orderId) return {};
  if (input.nextPaymentStatus === "REFUNDED" && input.currentPaymentStatus === "PAID") {
    // The gateway/bank reversal happened outside the app; this records it for
    // the whole order so no item keeps running as paid.
    const { data, error } = await db.rpc("refund_submission_order", {
      p_order_id: input.orderId,
      p_actor_user_id: input.actorUserId,
      p_admin_memo: input.adminMemo || null,
    });
    if (error || !data?.length) {
      return { error: error?.code === "55000"
        ? "결제 완료 상태의 주문만 환불로 기록할 수 있습니다. 주문 상태를 새로고침해주세요."
        : "주문 환불 기록을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };
    }
    return { refundedIds: data.map((row: { submission_id: string }) => row.submission_id) };
  }
  if (input.nextPaymentStatus !== "PAID") {
    return input.nextPaymentStatus === input.currentPaymentStatus
      ? {}
      : { error: "주문에 연결된 결제 상태는 개별 신청서에서 되돌릴 수 없습니다. 주문 내역에서 처리해주세요." };
  }
  const { data: order, error } = await db.from("submission_orders")
    .select("id, status, payment_method")
    .eq("id", input.orderId)
    .maybeSingle();
  if (error || !order) return { error: "연결된 주문 정보를 확인하지 못했습니다." };
  if (order.status === "PAID" && input.currentPaymentStatus === "PAID") return {};
  if (order.status !== "BANK_PENDING" || order.payment_method !== "BANK") {
    return { error: "입금 대기 중인 무통장 주문만 입금 확인할 수 있습니다. 카드 결제 결과는 결제사 확인이 필요합니다." };
  }
  const { data, error: confirmError } = await db.rpc("confirm_submission_order_bank_payment", {
    p_order_id: input.orderId,
    p_actor_user_id: input.actorUserId,
    p_admin_memo: input.adminMemo || null,
  });
  if (confirmError || !data?.length) return { error: "주문 입금 확인을 저장하지 못했습니다. 주문 상태를 새로고침해주세요." };
  return { confirmedIds: data.map((row: { submission_id: string }) => row.submission_id) };
}

export type UncertainPaymentOutcome = "APPROVED" | "FAILED";

/** Records what the Inicis console shows for an approval the callback could
 * not confirm. APPROVED needs the console TID; FAILED reopens the order so the
 * customer can pay again. No gateway request is made here. */
export async function resolveUncertainCardPayment(
  db: Pick<ReturnType<typeof createAdminClient>, "rpc">,
  input: { orderId: string; actorUserId: string; outcome: UncertainPaymentOutcome; pgTid?: string | null; adminMemo?: string | null },
): Promise<{ error?: string; submissionIds?: string[] }> {
  const { data, error } = await db.rpc("resolve_uncertain_submission_payment", {
    p_order_id: input.orderId,
    p_actor_user_id: input.actorUserId,
    p_outcome: input.outcome,
    p_pg_tid: input.pgTid?.trim() || null,
    p_admin_memo: input.adminMemo?.trim() || null,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("PG_TID_REQUIRED")) return { error: "승인 확인에는 이니시스 관리자 화면의 승인 TID가 필요합니다." };
    if (message.includes("PAYMENT_NOT_UNCERTAIN") || message.includes("ORDER_NOT_REVIEW_REQUIRED")) {
      return { error: "이미 처리됐거나 승인 확인이 필요한 상태가 아닙니다. 목록을 새로고침해주세요." };
    }
    if (error.code === "42501") return { error: "관리자 권한이 필요합니다." };
    if (message.includes("PAYMENT_NOT_FOUND")) return { error: "결제 요청을 찾을 수 없습니다." };
    return { error: "승인 확인 결과를 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  const submissionIds = ((data ?? []) as Array<{ submission_id: string }>).map((row) => row.submission_id);
  if (submissionIds.length === 0) return { error: "승인 확인 결과가 저장되지 않았습니다. 목록을 새로고침해주세요." };
  return { submissionIds };
}
