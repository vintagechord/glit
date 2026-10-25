"use client";

import * as React from "react";

import { ConfirmForm } from "@/components/admin/confirm-form";
import { resolveUncertainPaymentFormAction } from "@/features/admin/actions";

const fieldClass =
  "min-h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground";

/** Inline reconciliation for one uncertain card approval. The operator reads
 * the outcome in the Inicis console first; the app records it and notifies. */
export function UncertainPaymentResolver({ orderId }: { orderId: string }) {
  const [outcome, setOutcome] = React.useState<"APPROVED" | "FAILED">("APPROVED");
  return (
    <ConfirmForm
      action={resolveUncertainPaymentFormAction}
      message={
        outcome === "APPROVED"
          ? "이니시스 관리자 화면에서 이 주문번호의 승인(TID)을 확인했습니까? 결제 완료로 처리하고 고객에게 결제 완료 안내를 보냅니다."
          : "이니시스 관리자 화면에서 이 주문번호가 승인되지 않았음을 확인했습니까? 주문을 실패로 처리하고 고객이 다시 결제할 수 있게 됩니다."
      }
      className="mt-2 grid gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10"
      aria-label={`주문 ${orderId} 승인 확인 처리`}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <label className="text-[11px] font-semibold text-foreground">
        이니시스 확인 결과
        <select
          name="outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value === "FAILED" ? "FAILED" : "APPROVED")}
          className={`${fieldClass} mt-1`}
        >
          <option value="APPROVED">승인됨 · 결제 완료로 처리</option>
          <option value="FAILED">미승인 · 실패로 처리(재결제 가능)</option>
        </select>
      </label>
      {outcome === "APPROVED" ? (
        <label className="text-[11px] font-semibold text-foreground">
          승인 TID
          <input name="pgTid" required minLength={5} maxLength={64} pattern="[A-Za-z0-9_-]+" placeholder="이니시스 거래 TID" className={`${fieldClass} mt-1 font-mono`} />
        </label>
      ) : null}
      <label className="text-[11px] font-semibold text-foreground">
        메모(선택)
        <input name="adminMemo" maxLength={500} placeholder="대조한 거래 내역·담당자" className={`${fieldClass} mt-1`} />
      </label>
      <button
        type="submit"
        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-foreground bg-foreground px-3 text-xs font-semibold text-background"
      >
        {outcome === "APPROVED" ? "승인 확인 저장" : "미승인 확인 저장"}
      </button>
    </ConfirmForm>
  );
}
