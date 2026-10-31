import { NextResponse } from "next/server";
import { z } from "zod";

import {
  cashReceiptPdfFilename,
  loadCashReceiptOrder,
  loadCashReceiptRows,
  renderCashReceiptPdf,
} from "@/lib/cash-receipts-server";
import { buildAttachmentHeaders } from "@/lib/download-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Administrator copy of an issued (or cancelled) cash receipt PDF. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!user || isAdmin !== true) return json({ error: "관리자 권한이 필요합니다." }, 403);
  const orderId = z.string().uuid().safeParse((await context.params).id);
  if (!orderId.success) return json({ error: "주문 번호를 확인해주세요." }, 400);
  try {
    const db = createAdminClient();
    const [order, receipts] = await Promise.all([loadCashReceiptOrder(db, orderId.data), loadCashReceiptRows(db, [orderId.data])]);
    const receipt = receipts.get(orderId.data);
    const pdf = order && receipt ? await renderCashReceiptPdf(order, receipt) : null;
    if (!pdf || !receipt) return json({ error: "발급이 완료된 현금영수증이 없습니다." }, 404);
    return new NextResponse(new Uint8Array(pdf), {
      headers: buildAttachmentHeaders({ filename: cashReceiptPdfFilename(receipt), contentType: "application/pdf", contentLength: pdf.length }),
    });
  } catch {
    return json({ error: "현금영수증 PDF를 만들지 못했습니다." }, 500);
  }
}
