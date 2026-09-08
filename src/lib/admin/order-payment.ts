import type { createAdminClient } from "@/lib/supabase/admin";

/** A linked order owns payment state for its entire item group. Admin review
 * edits may update a paid submission's review stage, but cannot rewrite money
 * state independently or mark a card/PayPal attempt as a bank deposit. */
export async function confirmLinkedOrderPayment(
  db: Pick<ReturnType<typeof createAdminClient>, "from" | "rpc">,
  input: { orderId: string | null; currentPaymentStatus: string | null; nextPaymentStatus: string; actorUserId: string; adminMemo?: string | null },
): Promise<{ error?: string; confirmedIds?: string[] }> {
  if (!input.orderId) return {};
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
