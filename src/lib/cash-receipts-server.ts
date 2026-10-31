import type { createAdminClient } from "@/lib/supabase/admin";
import { APP_CONFIG } from "@/lib/config";
import {
  isCashReceiptEditable,
  maskCashReceiptIdentifier,
  splitVatInclusiveAmount,
  type CashReceiptIssueMethod,
  type CashReceiptPurpose,
  type CashReceiptRequestInput,
  type CashReceiptStatus,
  type CashReceiptSummary,
} from "@/lib/cash-receipts";
import { generateCashReceiptPdf } from "@/lib/cash-receipt-pdf";
import { getCashReceiptInicisConfig, issueCashReceiptWithInicis } from "@/lib/inicis/cash-receipt";

type Db = Pick<ReturnType<typeof createAdminClient>, "from">;

export type CashReceiptRow = {
  order_id: string;
  purpose: CashReceiptPurpose;
  identifier: string;
  status: CashReceiptStatus;
  issue_method: CashReceiptIssueMethod | null;
  approval_number: string | null;
  provider_tid: string | null;
  issued_at: string | null;
  amount_krw: number | null;
  supply_krw: number | null;
  vat_krw: number | null;
  failure_message: string | null;
  issued_by: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  requested_at: string;
  updated_at: string;
};

export type CashReceiptOrder = {
  id: string;
  user_id: string | null;
  payment_method: string;
  status: string;
  amount_krw: number | null;
  paid_at: string | null;
  created_at: string;
  depositor_name: string | null;
  items: Array<{ submission_id: string | null; title: string | null; artist_name: string | null; type: string | null }>;
};

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const RECEIPT_COLUMNS = "order_id,purpose,identifier,status,issue_method,approval_number,provider_tid,issued_at,amount_krw,supply_krw,vat_krw,failure_message,issued_by,canceled_at,cancel_reason,requested_at,updated_at";
const ORDER_COLUMNS = "id,user_id,payment_method,status,amount_krw,paid_at,created_at,depositor_name,items:submission_order_items(submission_id,title,artist_name,type)";
/** A customer may ask for a receipt while the transfer is pending or after it was confirmed. */
const REQUESTABLE_ORDER_STATUSES = new Set(["BANK_PENDING", "PAID"]);
const fail = <T>(status: number, error: string): Result<T> => ({ ok: false, status, error });
const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export function toCashReceiptSummary(row: CashReceiptRow): CashReceiptSummary {
  return {
    purpose: row.purpose,
    identifierMasked: maskCashReceiptIdentifier(row.identifier),
    status: row.status,
    approvalNumber: row.status === "ISSUED" || row.status === "CANCELED" ? row.approval_number : null,
    issuedAt: row.issued_at,
    amountKrw: row.amount_krw,
    supplyKrw: row.supply_krw,
    vatKrw: row.vat_krw,
    requestedAt: row.requested_at,
    canEdit: isCashReceiptEditable(row.status),
  };
}

/** Missing table (migration not yet applied) reads as "no receipts". */
export async function loadCashReceiptRows(db: Db, orderIds: string[]) {
  const rows = new Map<string, CashReceiptRow>();
  for (let offset = 0; offset < orderIds.length; offset += 200) {
    const { data, error } = await db.from("submission_order_cash_receipts").select(RECEIPT_COLUMNS).in("order_id", orderIds.slice(offset, offset + 200));
    if (error) { if (isMissingTable(error)) return rows; throw new Error("현금영수증 정보를 불러오지 못했습니다."); }
    for (const row of (data ?? []) as unknown as CashReceiptRow[]) rows.set(row.order_id, row);
  }
  return rows;
}

export async function loadCashReceiptOrder(db: Db, orderId: string) {
  const { data, error } = await db.from("submission_orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw new Error("주문 정보를 확인하지 못했습니다.");
  return (data ?? null) as unknown as CashReceiptOrder | null;
}

/**
 * Create, replace or withdraw (`request = null`) a customer's request. An
 * issued or in-flight receipt is never overwritten; the conditional update
 * keeps a concurrent issuance from being reset.
 */
export async function saveCashReceiptRequest(
  db: Db,
  order: Pick<CashReceiptOrder, "id" | "payment_method" | "status">,
  request: CashReceiptRequestInput | null,
): Promise<Result<CashReceiptSummary | null>> {
  if (order.payment_method !== "BANK") return fail(400, "무통장 입금 주문만 현금영수증을 신청할 수 있습니다.");
  if (!REQUESTABLE_ORDER_STATUSES.has(order.status)) return fail(409, "입금 대기 중이거나 입금이 확인된 주문만 현금영수증을 신청할 수 있습니다.");
  const existing = (await loadCashReceiptRows(db, [order.id])).get(order.id);
  if (existing && !isCashReceiptEditable(existing.status)) return fail(409, "이미 발급 중이거나 발급된 현금영수증은 변경할 수 없습니다. 고객센터로 문의해주세요.");
  const table = db.from("submission_order_cash_receipts");
  if (!request) {
    if (!existing) return { ok: true, value: null };
    const { error } = await table.delete().eq("order_id", order.id).in("status", ["REQUESTED", "FAILED", "CANCELED"]);
    return error ? fail(500, "현금영수증 신청을 취소하지 못했습니다.") : { ok: true, value: null };
  }
  const now = new Date().toISOString();
  const fields = {
    purpose: request.purpose, identifier: request.identifier, status: "REQUESTED" as const,
    issue_method: null, approval_number: null, provider_tid: null, issued_at: null,
    amount_krw: null, supply_krw: null, vat_krw: null, failure_message: null, issued_by: null,
    canceled_at: null, cancel_reason: null, requested_at: now, updated_at: now,
  };
  const { data, error } = existing
    ? await table.update(fields).eq("order_id", order.id).in("status", ["REQUESTED", "FAILED", "CANCELED"]).select(RECEIPT_COLUMNS).maybeSingle()
    : await table.insert({ order_id: order.id, ...fields }).select(RECEIPT_COLUMNS).maybeSingle();
  if (error?.code === "23505" || (!error && !data)) return fail(409, "현금영수증 상태가 바뀌었습니다. 새로고침 후 다시 확인해주세요.");
  if (error) return fail(isMissingTable(error) ? 503 : 500, "현금영수증 신청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
  return { ok: true, value: toCashReceiptSummary(data as unknown as CashReceiptRow) };
}

export function cashReceiptGoodName(order: Pick<CashReceiptOrder, "items">) {
  const [first, ...rest] = order.items;
  const label = first?.type === "ALBUM" ? "음반 심의" : first?.type?.startsWith("MV") ? "뮤직비디오 심의" : "심의 접수";
  const title = first?.title?.trim();
  const base = title ? `${label} · ${title}` : `온사이드 ${label}`;
  return rest.length ? `${base} 외 ${rest.length}건` : base;
}

async function loadBuyer(db: Db, order: CashReceiptOrder) {
  const submissionId = order.items.find((item) => item.submission_id)?.submission_id;
  const { data } = submissionId
    ? await db.from("submissions").select("applicant_name,applicant_email,applicant_phone,guest_name,guest_email,guest_phone").eq("id", submissionId).maybeSingle()
    : { data: null };
  const row = (data ?? {}) as Record<string, string | null>;
  return {
    name: row.applicant_name || row.guest_name || order.depositor_name || "고객",
    email: row.applicant_email || row.guest_email || APP_CONFIG.supportEmail,
    phone: row.applicant_phone || row.guest_phone || null,
  };
}

const issuedFields = (order: CashReceiptOrder) => {
  const amounts = splitVatInclusiveAmount(order.amount_krw ?? 0);
  return { amount_krw: amounts.totalKrw, supply_krw: amounts.supplyKrw, vat_krw: amounts.vatKrw };
};

async function requirePaidOrderWithReceipt(db: Db, orderId: string): Promise<Result<{ order: CashReceiptOrder; receipt: CashReceiptRow }>> {
  const order = await loadCashReceiptOrder(db, orderId);
  if (!order) return fail(404, "주문을 찾을 수 없습니다.");
  if (order.status !== "PAID") return fail(409, "입금 확인(결제완료) 후에 현금영수증을 발급할 수 있습니다.");
  if (!order.amount_krw || order.amount_krw <= 0) return fail(409, "주문 금액을 확인할 수 없습니다.");
  const receipt = (await loadCashReceiptRows(db, [orderId])).get(orderId);
  if (!receipt) return fail(404, "현금영수증 신청 내역이 없습니다.");
  return { ok: true, value: { order, receipt } };
}

export const isCashReceiptAutoIssueEnabled = () => Boolean(getCashReceiptInicisConfig());

/** Issue through KG Inicis. The row is claimed first so one request can win. */
export async function issueCashReceiptViaInicis(db: Db, orderId: string, actorUserId: string | null): Promise<Result<CashReceiptRow>> {
  const loaded = await requirePaidOrderWithReceipt(db, orderId);
  if (!loaded.ok) return loaded;
  const { order, receipt } = loaded.value;
  if (!["REQUESTED", "FAILED"].includes(receipt.status)) return fail(409, "발급 대기 중인 현금영수증만 발급할 수 있습니다.");
  if (!getCashReceiptInicisConfig()) return fail(503, "이니시스 INIAPI 키가 등록되지 않았습니다. 홈택스에서 발급한 뒤 승인번호를 입력해주세요.");
  const table = db.from("submission_order_cash_receipts");
  const { data: claimed, error: claimError } = await table.update({ status: "ISSUING", updated_at: new Date().toISOString(), failure_message: null })
    .eq("order_id", orderId).in("status", ["REQUESTED", "FAILED"]).select("order_id").maybeSingle();
  if (claimError || !claimed) return fail(409, "다른 화면에서 발급을 진행하고 있습니다. 새로고침 후 확인해주세요.");
  const amounts = issuedFields(order);
  const buyer = await loadBuyer(db, order).catch(() => ({ name: "고객", email: APP_CONFIG.supportEmail, phone: null }));
  const result = await issueCashReceiptWithInicis({
    totalKrw: amounts.amount_krw, supplyKrw: amounts.supply_krw, vatKrw: amounts.vat_krw,
    purpose: receipt.purpose, identifier: receipt.identifier, goodName: cashReceiptGoodName(order),
    buyerName: buyer.name, buyerEmail: buyer.email, buyerTel: buyer.phone,
  });
  const update = result.ok
    ? { status: "ISSUED", issue_method: "INICIS", approval_number: result.approvalNumber.slice(0, 40), provider_tid: result.tid?.slice(0, 80) ?? null, issued_at: result.issuedAt, ...amounts, issued_by: actorUserId, failure_message: null }
    : { status: "FAILED", failure_message: `${result.uncertain ? "[결과 확인 필요] " : ""}${result.message}`.slice(0, 500) };
  const { data, error } = await table.update({ ...update, updated_at: new Date().toISOString() }).eq("order_id", orderId).eq("status", "ISSUING").select(RECEIPT_COLUMNS).maybeSingle();
  if (error || !data) return fail(500, result.ok ? `이니시스 발급은 완료됐지만(승인번호 ${result.approvalNumber}) 저장하지 못했습니다. 승인번호를 수동으로 입력해주세요.` : "발급 결과를 저장하지 못했습니다.");
  return result.ok ? { ok: true, value: data as unknown as CashReceiptRow } : fail(result.uncertain ? 504 : 502, result.message);
}

/** Record a receipt the administrator issued in Hometax or the Inicis console. */
export async function recordManualCashReceipt(db: Db, orderId: string, actorUserId: string, input: { approvalNumber: string; issuedAt: string }): Promise<Result<CashReceiptRow>> {
  const approvalNumber = input.approvalNumber.replace(/\s/g, "");
  if (!/^[0-9A-Za-z-]{1,40}$/.test(approvalNumber)) return fail(400, "승인번호는 숫자·영문·하이픈으로 40자 이내여야 합니다.");
  const issuedAt = new Date(input.issuedAt);
  if (Number.isNaN(issuedAt.getTime()) || issuedAt.getTime() > Date.now() + 5 * 60_000) return fail(400, "발급 일시를 확인해주세요.");
  const loaded = await requirePaidOrderWithReceipt(db, orderId);
  if (!loaded.ok) return loaded;
  if (!["REQUESTED", "FAILED"].includes(loaded.value.receipt.status)) return fail(409, "발급 대기 중인 현금영수증만 승인번호를 입력할 수 있습니다.");
  const { data, error } = await db.from("submission_order_cash_receipts").update({
    status: "ISSUED", issue_method: "MANUAL", approval_number: approvalNumber, provider_tid: null,
    issued_at: issuedAt.toISOString(), ...issuedFields(loaded.value.order), issued_by: actorUserId,
    failure_message: null, updated_at: new Date().toISOString(),
  }).eq("order_id", orderId).in("status", ["REQUESTED", "FAILED"]).select(RECEIPT_COLUMNS).maybeSingle();
  if (error || !data) return fail(409, "현금영수증 상태가 바뀌었습니다. 새로고침 후 다시 확인해주세요.");
  return { ok: true, value: data as unknown as CashReceiptRow };
}

/**
 * Mark a request or receipt as cancelled. For an issued receipt this only
 * records the cancellation made in Hometax or the Inicis console.
 */
export async function cancelCashReceipt(db: Db, orderId: string, actorUserId: string, reason: string): Promise<Result<CashReceiptRow>> {
  const note = reason.trim().slice(0, 300);
  if (!note) return fail(400, "취소 사유를 입력해주세요.");
  const { data, error } = await db.from("submission_order_cash_receipts").update({
    status: "CANCELED", canceled_at: new Date().toISOString(), cancel_reason: note, issued_by: actorUserId, updated_at: new Date().toISOString(),
  }).eq("order_id", orderId).in("status", ["REQUESTED", "FAILED", "ISSUED"]).select(RECEIPT_COLUMNS).maybeSingle();
  if (error || !data) return fail(409, "취소할 수 있는 현금영수증이 없습니다. 새로고침 후 확인해주세요.");
  return { ok: true, value: data as unknown as CashReceiptRow };
}

/** Called after an administrator confirms a deposit; never throws. */
export async function autoIssueRequestedCashReceipt(db: Db, orderId: string, actorUserId: string | null) {
  try {
    if (!isCashReceiptAutoIssueEnabled()) return;
    const receipt = (await loadCashReceiptRows(db, [orderId])).get(orderId);
    if (receipt?.status !== "REQUESTED") return;
    const result = await issueCashReceiptViaInicis(db, orderId, actorUserId);
    if (!result.ok) console.error("[cash-receipt] automatic issuance needs review", { status: result.status });
  } catch {
    console.error("[cash-receipt] automatic issuance failed");
  }
}

export async function renderCashReceiptPdf(order: CashReceiptOrder, receipt: CashReceiptRow) {
  if (!receipt.approval_number || !receipt.issued_at || receipt.amount_krw == null || !["ISSUED", "CANCELED"].includes(receipt.status) || !receipt.issue_method) return null;
  return generateCashReceiptPdf({
    orderId: order.id, purpose: receipt.purpose, identifier: receipt.identifier,
    approvalNumber: receipt.approval_number, issuedAt: receipt.issued_at, issueMethod: receipt.issue_method,
    amountKrw: receipt.amount_krw, supplyKrw: receipt.supply_krw ?? 0, vatKrw: receipt.vat_krw ?? 0,
    goodName: cashReceiptGoodName(order),
    canceled: receipt.status === "CANCELED" ? { at: receipt.canceled_at, reason: receipt.cancel_reason } : null,
    business: {
      name: APP_CONFIG.businessName, representative: APP_CONFIG.businessRep, registrationNumber: APP_CONFIG.businessRegNo,
      address: APP_CONFIG.businessAddress, phone: APP_CONFIG.supportPhone,
    },
  });
}

export const cashReceiptPdfFilename = (receipt: Pick<CashReceiptRow, "approval_number">) => `현금영수증_${receipt.approval_number ?? "onside"}.pdf`;
