"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminAction } from "@/lib/admin/action-auth";
import {
  cancelCashReceipt,
  issueCashReceiptViaInicis,
  recordManualCashReceipt,
} from "@/lib/cash-receipts-server";
import { createAdminClient } from "@/lib/supabase/admin";

const orderIdSchema = z.string().uuid();
const backTo = (filter: string, orderId: string, query: string) =>
  `/admin/cash-receipts?filter=${encodeURIComponent(filter)}&${query}#order-${orderId}`;
const formFilter = (formData: FormData) => {
  const value = String(formData.get("filter") ?? "attention");
  return /^[a-z]{2,20}$/.test(value) ? value : "attention";
};

function refresh() {
  revalidatePath("/admin/cash-receipts");
  revalidatePath("/mypage/orders");
  revalidatePath("/en/mypage/orders");
}

export async function issueCashReceiptAction(formData: FormData) {
  const actor = await requireAdminAction();
  const orderId = orderIdSchema.parse(String(formData.get("orderId") ?? ""));
  const result = await issueCashReceiptViaInicis(createAdminClient(), orderId, actor.id);
  refresh();
  redirect(backTo(formFilter(formData), orderId, result.ok ? "saved=issued" : `error=${encodeURIComponent(result.error)}`));
}

export async function recordManualCashReceiptAction(formData: FormData) {
  const actor = await requireAdminAction();
  const orderId = orderIdSchema.parse(String(formData.get("orderId") ?? ""));
  const issuedAtLocal = String(formData.get("issuedAt") ?? "");
  // The admin form uses datetime-local in Korean time.
  const issuedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(issuedAtLocal) ? `${issuedAtLocal}:00+09:00` : "";
  const result = await recordManualCashReceipt(createAdminClient(), orderId, actor.id, {
    approvalNumber: String(formData.get("approvalNumber") ?? ""),
    issuedAt,
  });
  refresh();
  redirect(backTo(formFilter(formData), orderId, result.ok ? "saved=recorded" : `error=${encodeURIComponent(result.error)}`));
}

export async function cancelCashReceiptAction(formData: FormData) {
  const actor = await requireAdminAction();
  const orderId = orderIdSchema.parse(String(formData.get("orderId") ?? ""));
  const result = await cancelCashReceipt(createAdminClient(), orderId, actor.id, String(formData.get("reason") ?? ""));
  refresh();
  redirect(backTo(formFilter(formData), orderId, result.ok ? "saved=canceled" : `error=${encodeURIComponent(result.error)}`));
}
