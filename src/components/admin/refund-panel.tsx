"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { recordRefundAction } from "@/features/admin/actions";
import { showCenteredAlert, showCenteredConfirm } from "@/lib/centered-dialog";

type RefundMethod = "CARD_CANCEL" | "BANK_TRANSFER" | "OTHER";
const methodLabels: Record<RefundMethod, string> = {
  CARD_CANCEL: "카드 결제 취소 (KG이니시스 관리자에서 취소함)",
  BANK_TRANSFER: "계좌 송금 (고객 계좌로 돌려보냄)",
  OTHER: "기타",
};

/** 환불 처리: the money goes back outside the app (Inicis console or a bank
 * transfer); this records it so payment state, customer pages and file
 * cleanup follow. */
export function AdminRefundPanel({
  submissionId,
  paymentStatus,
  paymentMethod,
  amountKrw,
  orderTitles,
  cashReceiptIssued,
  refundedAt,
}: {
  submissionId: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  amountKrw: number | null;
  orderTitles: string[];
  cashReceiptIssued: boolean;
  refundedAt: string | null;
}) {
  const router = useRouter();
  const [method, setMethod] = React.useState<RefundMethod>(paymentMethod === "BANK" ? "BANK_TRANSFER" : "CARD_CANCEL");
  const [note, setNote] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [notify, setNotify] = React.useState(true);
  // Refunds are rare: the form stays folded until an administrator opens it.
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const receiptNotice = cashReceiptIssued ? (
    <p className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] p-3 text-xs font-semibold leading-5 text-[#111111]">
      이 주문은 현금영수증이 발급되어 있습니다. 환불했다면{" "}
      <Link href="/admin/cash-receipts" className="underline underline-offset-2">현금영수증 관리</Link>에서 발급 취소도 처리해주세요.
    </p>
  ) : null;

  if (paymentStatus === "REFUNDED") {
    return (
      <div className="space-y-3 rounded-[28px] border-2 border-[#111111] bg-card p-6 text-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">환불</p>
        <p className="font-black">
          환불 완료{refundedAt ? ` · ${new Date(refundedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">환불 방법과 메모는 관리자 메모에 기록되어 있습니다. 고객 화면에는 환불 상태로 표시되고 심의 진행은 중단됩니다.</p>
        {receiptNotice}
      </div>
    );
  }
  if (paymentStatus !== "PAID") return null;

  const groupCount = orderTitles.length;
  const submit = async () => {
    if (pending || !done) return;
    const target = groupCount > 1 ? `같은 주문으로 결제한 접수 ${groupCount}건` : "이 접수";
    if (!(await showCenteredConfirm(`${target}을 환불 완료로 기록할까요? 결제 상태가 '환불'로 바뀌고 심의 진행이 중단됩니다.`, { title: "환불 기록" }))) return;
    startTransition(async () => {
      const result = await recordRefundAction({ submissionId, method, note: note.trim() || undefined, notifyCustomer: notify })
        .catch(() => ({ error: "환불을 기록하지 못했습니다. 잠시 후 다시 시도해주세요." } as { error: string; message?: string; warning?: string }));
      if (result.error) {
        await showCenteredAlert(result.error, { title: "환불을 기록하지 못했습니다" });
        return;
      }
      await showCenteredAlert([result.message, result.warning].filter(Boolean).join("\n"), { title: "환불 기록 완료" });
      router.refresh();
    });
  };

  const panelId = `refund-panel-${submissionId}`;
  return (
    <div className="space-y-4 rounded-[28px] border-2 border-[#111111] bg-card p-6 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">환불 처리</p>
          {!open ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">환불이 필요할 때 펼쳐서 기록합니다.</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "환불 처리 접기" : "환불 처리 펼치기"}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[8px] border-2 border-[#111111] bg-white px-3 py-1 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white dark:border-[#f2cf27] dark:bg-[#111111] dark:text-[#f2cf27]"
        >
          <span aria-hidden>{open ? "▲" : "▼"}</span>
          <span>{open ? "접기" : "펼치기"}</span>
        </button>
      </div>
      {open ? (
      <div id={panelId} className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">
        실제 환불은 먼저 직접 처리해주세요. 카드 결제는 KG이니시스 관리자에서 결제를 취소하고, 무통장 입금은 고객 계좌로 송금합니다. 여기서는 그 환불을 온사이드에 기록합니다.
      </p>
      {groupCount > 1 ? (
        <div className="rounded-[8px] border-2 border-[#111111] bg-background p-3 text-xs leading-5">
          <p className="font-black">같은 주문으로 결제한 {groupCount}건이 함께 환불로 기록됩니다.</p>
          <ul className="mt-1 list-disc pl-4">
            {orderTitles.map((title, index) => <li key={`${title}-${index}`}><span data-no-translate>{title}</span></li>)}
          </ul>
        </div>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-muted-foreground">
          환불 방법{amountKrw ? ` · 결제 금액 ${amountKrw.toLocaleString("ko-KR")}원` : ""}
        </legend>
        {(Object.keys(methodLabels) as RefundMethod[]).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`refund-method-${submissionId}`} value={key} checked={method === key} onChange={() => setMethod(key)} disabled={pending} />
            {methodLabels[key]}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-muted-foreground">환불 메모 (선택 · 고객 화면에는 표시되지 않습니다)</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          disabled={pending}
          placeholder="예: 이니시스 취소 처리, 신한 110-***-1234로 송금"
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
      </label>
      {receiptNotice}
      <label className="flex items-start gap-2 text-sm font-semibold">
        <input type="checkbox" checked={done} onChange={(event) => setDone(event.target.checked)} disabled={pending} className="mt-1" />
        실제 환불(카드 결제 취소 또는 계좌 송금)을 마쳤습니다.
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} disabled={pending} className="mt-1" />
        고객에게 환불 안내 메일 보내기
      </label>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!done || pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-4 text-sm font-black text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0"
      >
        {pending ? "기록 중…" : "환불 완료로 기록"}
      </button>
      </div>
      ) : null}
    </div>
  );
}
