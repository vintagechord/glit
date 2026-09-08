import { createHash, timingSafeEqual } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { SubmissionOrder, SubmissionOrderStatus, SubmissionOrdersPage } from "@/lib/submission-orders-types";

type OrdersDb = Pick<ReturnType<typeof createAdminClient>, "from" | "rpc">;
export type OrderActor = { userId: string | null; guestTokensBySubmissionId: Record<string, string> };
type RawItem = {
  id: string; submission_id: string | null; submission_ref: string; type: string;
  title: string | null; artist_name: string | null; package_name: string | null;
  amount_krw: number | null; amount: number | null; is_oneclick: boolean;
  guest_token_hash: string | null;
};
type RawOrder = {
  id: string; user_id: string | null; payment_method: SubmissionOrder["paymentMethod"];
  status: SubmissionOrderStatus; amount_krw: number | null; amount: number | null;
  currency: string; source: string; note: string | null; created_at: string; updated_at: string;
  paid_at: string | null; returned_at: string | null; items: RawItem[];
  payments: { status: string; result_code: string | null } | Array<{ status: string; result_code: string | null }> | null;
};
type Parent = {
  id: string; user_id: string | null; guest_token: string | null; current_order_id: string | null;
  status: string; payment_status: string; result_status: string | null; result_notified_at: string | null;
  user_deleted_at: string | null; reviews: Array<{ status: string }>;
};

const orderSelect = "id,user_id,payment_method,status,amount_krw,amount,currency,source,note,created_at,updated_at,paid_at,returned_at,items:submission_order_items(id,submission_id,submission_ref,type,title,artist_name,package_name,amount_krw,amount,is_oneclick,guest_token_hash),payments:submission_payments!checkout_order_id(status,result_code)";
const pageSize = 30;
const returnableStatuses = new Set(["BANK_PENDING", "CARD_PENDING", "PAYPAL_PENDING", "FAILED", "CANCELED"]);
const finiteAmount = (value: number | null) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

const matchesGuestSnapshot = (token: string | undefined, hash: string | null) => {
  if (!token || !hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  return timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(hash, "hex"));
};

async function loadParents(db: OrdersDb, orders: RawOrder[]) {
  const ids = [...new Set(orders.flatMap(order => order.items.map(item => item.submission_id).filter((id): id is string => Boolean(id))))];
  const parents = new Map<string, Parent>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await db.from("submissions")
      .select("id,user_id,guest_token,current_order_id,status,payment_status,result_status,result_notified_at,user_deleted_at,reviews:station_reviews(status)")
      .in("id", ids.slice(offset, offset + 200));
    if (error) throw new Error("주문 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
    for (const parent of (data ?? []) as unknown as Parent[]) parents.set(parent.id, parent);
  }
  return parents;
}

function ownsOrder(order: RawOrder, actor: OrderActor, parents: Map<string, Parent>) {
  if (actor.userId) return order.user_id === actor.userId;
  if (order.user_id || !order.items.length) return false;
  return order.items.every(item => {
    const token = actor.guestTokensBySubmissionId[item.submission_ref];
    const parent = item.submission_id ? parents.get(item.submission_id) : undefined;
    return parent
      ? !parent.user_id && Boolean(token) && token === parent.guest_token
      : matchesGuestSnapshot(token, item.guest_token_hash);
  });
}

function mapOrder(order: RawOrder, actor: OrderActor, parents: Map<string, Parent>): SubmissionOrder {
  const payments = Array.isArray(order.payments) ? order.payments : order.payments ? [order.payments] : [];
  const canReturnToCart = returnableStatuses.has(order.status) && !order.returned_at &&
    order.items.length > 0 && !payments.some(payment => payment.status === "APPROVED" || ["CAPTURE_IN_PROGRESS", "APPROVAL_IN_PROGRESS", "APPROVAL_UNCERTAIN"].includes(payment.result_code ?? "")) &&
    order.items.every(item => {
      const parent = item.submission_id ? parents.get(item.submission_id) : undefined;
      return parent && parent.current_order_id === order.id && !parent.user_deleted_at &&
        ["SUBMITTED", "WAITING_PAYMENT"].includes(parent.status) &&
        ["UNPAID", "PAYMENT_PENDING"].includes(parent.payment_status) &&
        !parent.result_status?.trim() && !parent.result_notified_at &&
        parent.reviews.every(review => review.status === "NOT_SENT") &&
        (actor.userId ? parent.user_id === actor.userId : !parent.user_id && actor.guestTokensBySubmissionId[parent.id] === parent.guest_token);
    });
  return {
    id: order.id, paymentMethod: order.payment_method, status: order.status,
    amountKrw: finiteAmount(order.amount_krw), amount: finiteAmount(order.amount),
    currency: order.currency, source: order.source, note: order.note,
    createdAt: order.created_at, updatedAt: order.updated_at, paidAt: order.paid_at,
    returnedAt: order.returned_at, canReturnToCart: Boolean(canReturnToCart),
    items: order.items.map(item => ({
      id: item.id, submissionId: item.submission_id, submissionRef: item.submission_ref,
      type: item.type ?? "REVIEW", title: item.title, artistName: item.artist_name, packageName: item.package_name,
      amountKrw: finiteAmount(item.amount_krw), amount: finiteAmount(item.amount), isOneclick: Boolean(item.is_oneclick),
    })),
  };
}

export async function listSubmissionOrders(db: OrdersDb, actor: OrderActor, offset = 0): Promise<SubmissionOrdersPage> {
  const guestIds = Object.keys(actor.guestTokensBySubmissionId);
  if (!actor.userId && guestIds.length === 0) return { orders: [], nextOffset: null };
  let query = db.from("submission_orders").select(actor.userId ? orderSelect : `${orderSelect},matching_items:submission_order_items!inner(submission_ref)`);
  query = actor.userId
    ? query.eq("user_id", actor.userId)
    : query.is("user_id", null).in("matching_items.submission_ref", guestIds);
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + pageSize);
  if (error) throw new Error("주문내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  const rows = (data ?? []) as unknown as RawOrder[];
  const parents = await loadParents(db, rows);
  const visible = rows.slice(0, pageSize).filter(order => ownsOrder(order, actor, parents));
  return {
    orders: visible.map(order => mapOrder(order, actor, parents)),
    nextOffset: rows.length > pageSize && visible.length > 0 ? offset + pageSize : null,
  };
}

export async function returnSubmissionOrderToCart(db: OrdersDb, orderId: string, actor: OrderActor) {
  const { data, error } = await db.from("submission_orders").select(orderSelect).eq("id", orderId).maybeSingle();
  if (error) return { ok: false as const, status: 500, error: "주문 정보를 확인하지 못했습니다." };
  const order = data as unknown as RawOrder | null;
  if (!order) return { ok: false as const, status: 404, error: "주문을 찾을 수 없습니다." };
  const parents = await loadParents(db, [order]);
  if (!ownsOrder(order, actor, parents)) return { ok: false as const, status: 403, error: "주문의 소유권을 확인할 수 없습니다." };
  if (!mapOrder(order, actor, parents).canReturnToCart) return { ok: false as const, status: 409, error: "현재 주문은 장바구니로 돌릴 수 없습니다. 결제 상태를 확인해주세요." };
  const { data: returned, error: returnError } = await db.rpc("return_submission_order_to_cart", {
    p_order_id: orderId, p_user_id: actor.userId, p_guest_tokens_by_submission_id: actor.guestTokensBySubmissionId,
  });
  if (returnError) return {
    ok: false as const, status: returnError.code === "42501" ? 403 : returnError.code === "55000" ? 409 : 500,
    error: "주문 상태가 변경되어 장바구니로 돌리지 못했습니다. 새로고침 후 확인해주세요.",
  };
  const submissionIds = [...new Set(((returned ?? []) as Array<{ submission_id: string }>).map(row => row.submission_id))];
  const expectedIds = order.items.map(item => item.submission_id);
  if (submissionIds.length !== expectedIds.length || expectedIds.some(id => !id || !submissionIds.includes(id))) {
    return { ok: false as const, status: 500, error: "변경된 주문 상태를 확인하지 못했습니다. 새로고침해주세요." };
  }
  return { ok: true as const, submissionIds };
}
