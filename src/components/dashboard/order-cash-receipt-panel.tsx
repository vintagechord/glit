"use client";

import { Download, Receipt } from "lucide-react";
import * as React from "react";

import { CashReceiptFields, type CashReceiptDraft } from "@/components/dashboard/cash-receipt-fields";
import { downloadEndpointFile } from "@/lib/browser-download";
import {
  CASH_RECEIPT_PURPOSE_LABELS,
  CASH_RECEIPT_STATUS_LABELS,
  validateCashReceiptRequest,
  type CashReceiptSummary,
} from "@/lib/cash-receipts";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { formatDateTime } from "@/lib/format";
import type { SubmissionOrder } from "@/lib/submission-orders-types";
import { cn } from "@/lib/utils";

const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-background px-3 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60";

/** Cash receipt status, request form and PDF download for one bank order. */
export function OrderCashReceiptPanel({ order, guestTokens, onChanged }: {
  order: SubmissionOrder;
  guestTokens: Record<string, string>;
  onChanged: (orderId: string, receipt: CashReceiptSummary | null) => void;
}) {
  const receipt = order.cashReceipt ?? null;
  const orderOpen = order.status === "BANK_PENDING" || order.status === "PAID";
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<CashReceiptDraft>({ purpose: receipt?.purpose ?? "", identifier: "" });
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ error: boolean; text: string } | null>(null);
  const idPrefix = `order-${order.id}`;
  if (order.paymentMethod !== "BANK" || (!receipt && !orderOpen)) return null;

  const guestHeader = Object.keys(guestTokens).length
    ? { "x-order-guest-tokens": encodeURIComponent(JSON.stringify(guestTokens)) }
    : undefined;

  const save = async (next: CashReceiptDraft | null) => {
    let cashReceipt = null;
    if (next?.purpose) {
      const valid = validateCashReceiptRequest(next);
      if (!valid.ok) { setMessage({ error: true, text: valid.error }); return; }
      cashReceipt = valid.value;
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetchWithTimeout(`/api/orders/${encodeURIComponent(order.id)}/cash-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestTokensBySubmissionId: guestTokens, cashReceipt }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; cashReceipt?: CashReceiptSummary | null };
      if (!response.ok) throw new Error(payload.error ?? "현금영수증 신청을 저장하지 못했습니다.");
      onChanged(order.id, payload.cashReceipt ?? null);
      setEditing(false);
      setMessage({ error: false, text: cashReceipt ? "현금영수증 신청을 저장했습니다." : "현금영수증 신청을 취소했습니다." });
    } catch (failure) {
      setMessage({ error: true, text: failure instanceof Error ? failure.message : "현금영수증 신청을 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true); setMessage(null);
    try {
      await downloadEndpointFile(`/api/orders/${encodeURIComponent(order.id)}/cash-receipt`, "현금영수증.pdf", { headers: guestHeader });
    } catch (failure) {
      setMessage({ error: true, text: failure instanceof Error ? failure.message : "현금영수증을 내려받지 못했습니다." });
    } finally {
      setBusy(false);
    }
  };

  const canEdit = orderOpen && (!receipt || receipt.canEdit);
  const issued = receipt?.status === "ISSUED" || (receipt?.status === "CANCELED" && Boolean(receipt.approvalNumber));
  return (
    <section aria-label="현금영수증" className="mt-4 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-black"><Receipt size={15} aria-hidden />현금영수증</p>
        <span className={cn(
          "inline-flex rounded-[6px] border-2 border-[var(--bauhaus-ink)] px-2 py-0.5 text-[11px] font-black",
          receipt?.status === "ISSUED" ? "bg-[var(--bauhaus-blue)] text-white"
            : receipt?.status === "FAILED" || receipt?.status === "CANCELED" ? "bg-[var(--bauhaus-red)] text-white"
              : receipt ? "bg-[var(--bauhaus-yellow)] text-[#111111]" : "bg-background text-foreground",
        )}>{receipt ? CASH_RECEIPT_STATUS_LABELS[receipt.status] : "신청 안 함"}</span>
      </div>
      {receipt && !editing && (
        <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-6">
          <dt className="text-muted-foreground">용도</dt><dd>{CASH_RECEIPT_PURPOSE_LABELS[receipt.purpose]}</dd>
          <dt className="text-muted-foreground">발급 번호</dt><dd className="font-semibold tabular-nums" data-no-translate>{receipt.identifierMasked}</dd>
          {receipt.approvalNumber && <><dt className="text-muted-foreground">승인번호</dt><dd className="font-black tabular-nums">{receipt.approvalNumber}</dd></>}
          {receipt.issuedAt && <><dt className="text-muted-foreground">발급일시</dt><dd>{formatDateTime(receipt.issuedAt)}</dd></>}
        </dl>
      )}
      {!editing && (
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {receipt?.status === "ISSUED" ? "국세청 홈택스에서도 발급 내역을 조회할 수 있습니다."
            : receipt?.status === "REQUESTED" ? (order.status === "PAID" ? "입금이 확인되어 발급을 준비하고 있습니다." : "입금이 확인되면 발급합니다.")
              : receipt?.status === "ISSUING" ? "발급을 처리하고 있습니다."
                : receipt?.status === "FAILED" ? "발급 정보를 확인하고 있습니다. 번호가 다르면 수정해주세요."
                  : receipt?.status === "CANCELED" ? "발급이 취소되었습니다. 필요하면 다시 신청해주세요."
                    : "입금 대기 중이거나 입금이 확인된 주문은 현금영수증을 신청할 수 있습니다."}
        </p>
      )}
      {editing && (
        <div className="mt-3">
          <CashReceiptFields idPrefix={idPrefix} value={draft} onChange={setDraft} disabled={busy} />
        </div>
      )}
      {message && <p role={message.error ? "alert" : "status"} className={cn("mt-2 text-xs font-semibold leading-5", message.error ? "text-[var(--bauhaus-red)]" : "text-foreground")}>{message.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {issued && <button type="button" className={cn(buttonClass, "bg-[var(--bauhaus-yellow)] text-[#111111]")} disabled={busy} onClick={() => void download()}><Download size={14} aria-hidden />PDF 다운로드</button>}
        {canEdit && !editing && <button type="button" className={buttonClass} disabled={busy} onClick={() => { setDraft({ purpose: receipt?.purpose ?? "INCOME_DEDUCTION", identifier: "" }); setEditing(true); setMessage(null); }}>{receipt ? "신청 정보 변경" : "현금영수증 신청"}</button>}
        {canEdit && !editing && receipt && receipt.status !== "CANCELED" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void save(null)}>신청 취소</button>}
        {editing && <>
          <button type="button" className={cn(buttonClass, "bg-[var(--bauhaus-blue)] text-white")} disabled={busy} onClick={() => void save(draft.purpose ? draft : null)}>{busy ? "저장 중..." : "저장"}</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => { setEditing(false); setMessage(null); }}>닫기</button>
        </>}
      </div>
    </section>
  );
}
