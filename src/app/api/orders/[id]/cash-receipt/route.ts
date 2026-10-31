import { NextResponse } from "next/server";
import { z } from "zod";

import { validateCashReceiptRequest } from "@/lib/cash-receipts";
import {
  cashReceiptPdfFilename,
  loadCashReceiptOrder,
  loadCashReceiptRows,
  renderCashReceiptPdf,
  saveCashReceiptRequest,
} from "@/lib/cash-receipts-server";
import { buildAttachmentHeaders } from "@/lib/download-response";
import { readBoundedJsonBody } from "@/lib/request-body";
import { loadOwnedSubmissionOrder } from "@/lib/submission-orders";
import { checkOrderRequest, orderGuestTokensSchema, orderJson } from "@/lib/submission-orders-http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const orderIdSchema = z.string().uuid();
const saveSchema = z.object({
  guestTokensBySubmissionId: orderGuestTokensSchema.default({}),
  cashReceipt: z.object({
    purpose: z.enum(["INCOME_DEDUCTION", "EXPENSE_PROOF"]),
    identifier: z.string().min(1).max(40),
  }).strict().nullable(),
}).strict();

async function actorFor(guestTokensBySubmissionId: Record<string, string>) {
  const user = await getServerSessionUser(await createServerSupabase());
  return { userId: user?.id ?? null, guestTokensBySubmissionId: user ? {} : guestTokensBySubmissionId };
}

/** Request, change or withdraw a cash receipt for the customer's own bank-transfer order. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = checkOrderRequest(request, true);
  if (denied) return denied;
  const orderId = orderIdSchema.safeParse((await context.params).id);
  if (!orderId.success) return orderJson({ error: "주문 번호를 확인해주세요." }, 400);
  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) return orderJson({ error: "현금영수증 신청 정보를 확인해주세요." }, body.reason === "too_large" ? 413 : 400);
  const parsed = saveSchema.safeParse(body.value);
  if (!parsed.success) return orderJson({ error: "현금영수증 신청 정보를 확인해주세요." }, 400);
  let receipt = null;
  if (parsed.data.cashReceipt) {
    const valid = validateCashReceiptRequest(parsed.data.cashReceipt);
    if (!valid.ok) return orderJson({ error: valid.error }, 400);
    receipt = valid.value;
  }
  const actor = await actorFor(parsed.data.guestTokensBySubmissionId);
  if (!actor.userId && Object.keys(actor.guestTokensBySubmissionId).length === 0) {
    return orderJson({ error: "로그인 또는 비회원 주문 정보가 필요합니다." }, 401);
  }
  try {
    const db = createAdminClient();
    const owned = await loadOwnedSubmissionOrder(db, orderId.data, actor);
    if (!owned.ok) return orderJson({ error: owned.error }, owned.status);
    const saved = await saveCashReceiptRequest(db, owned.order, receipt);
    if (!saved.ok) return orderJson({ error: saved.error }, saved.status);
    return orderJson({ ok: true, cashReceipt: saved.value });
  } catch {
    return orderJson({ error: "현금영수증 신청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
  }
}

/** Download the issued receipt as PDF. Guests send their tokens in a header. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = checkOrderRequest(request);
  if (denied) return denied;
  const orderId = orderIdSchema.safeParse((await context.params).id);
  if (!orderId.success) return orderJson({ error: "주문 번호를 확인해주세요." }, 400);
  let guestTokens: Record<string, string> = {};
  const header = request.headers.get("x-order-guest-tokens");
  if (header) {
    try {
      const parsed = orderGuestTokensSchema.safeParse(JSON.parse(decodeURIComponent(header)));
      if (!parsed.success) throw new Error("invalid");
      guestTokens = parsed.data;
    } catch {
      return orderJson({ error: "비회원 주문 정보를 확인해주세요." }, 400);
    }
  }
  const actor = await actorFor(guestTokens);
  if (!actor.userId && Object.keys(actor.guestTokensBySubmissionId).length === 0) {
    return orderJson({ error: "로그인 또는 비회원 주문 정보가 필요합니다." }, 401);
  }
  try {
    const db = createAdminClient();
    const owned = await loadOwnedSubmissionOrder(db, orderId.data, actor);
    if (!owned.ok) return orderJson({ error: owned.error }, owned.status);
    const [order, receipts] = await Promise.all([loadCashReceiptOrder(db, orderId.data), loadCashReceiptRows(db, [orderId.data])]);
    const receipt = receipts.get(orderId.data);
    const pdf = order && receipt ? await renderCashReceiptPdf(order, receipt) : null;
    if (!pdf || !receipt) return orderJson({ error: "발급이 완료된 현금영수증이 없습니다." }, 404);
    return new NextResponse(new Uint8Array(pdf), {
      headers: buildAttachmentHeaders({ filename: cashReceiptPdfFilename(receipt), contentType: "application/pdf", contentLength: pdf.length }),
    });
  } catch {
    return orderJson({ error: "현금영수증 PDF를 만들지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
  }
}
