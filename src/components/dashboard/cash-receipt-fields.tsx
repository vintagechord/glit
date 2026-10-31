"use client";

import * as React from "react";

import {
  CASH_RECEIPT_IDENTIFIER_HINT,
  type CashReceiptPurpose,
} from "@/lib/cash-receipts";
import { cn } from "@/lib/utils";

export type CashReceiptDraft = { purpose: "" | CashReceiptPurpose; identifier: string };

const options: Array<{ value: CashReceiptDraft["purpose"]; label: string }> = [
  { value: "", label: "신청 안 함" },
  { value: "INCOME_DEDUCTION", label: "개인 소득공제" },
  { value: "EXPENSE_PROOF", label: "사업자 지출증빙" },
];

/** Bank-transfer cash receipt choice, shared by the cart and the order list. */
export function CashReceiptFields({ value, onChange, disabled, idPrefix }: {
  value: CashReceiptDraft;
  onChange: (next: CashReceiptDraft) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const inputId = `${idPrefix}-cash-receipt-identifier`;
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-xs font-black text-foreground">현금영수증</legend>
      <div role="radiogroup" aria-label="현금영수증 용도" className="grid grid-cols-3 gap-1.5">
        {options.map((option) => {
          const selected = value.purpose === option.value;
          return (
            <button
              key={option.value || "none"}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ purpose: option.value, identifier: option.value === value.purpose ? value.identifier : "" })}
              className={cn(
                "min-h-11 rounded-[6px] border-2 border-[var(--bauhaus-ink)] px-1.5 text-[11px] font-black leading-4 transition disabled:opacity-60",
                selected ? "bg-[var(--bauhaus-blue)] text-white" : "bg-white text-[#111111] hover:bg-[var(--bauhaus-yellow)]",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {value.purpose ? (
        <label htmlFor={inputId} className="grid gap-1 text-xs font-black text-foreground">
          {CASH_RECEIPT_IDENTIFIER_HINT[value.purpose]}
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete={value.purpose === "INCOME_DEDUCTION" ? "tel" : "off"}
            maxLength={24}
            value={value.identifier}
            placeholder={value.purpose === "INCOME_DEDUCTION" ? "010-0000-0000" : "000-00-00000"}
            onChange={(event) => onChange({ ...value, identifier: event.target.value })}
            className="min-h-11 rounded-[6px] border-2 border-[var(--bauhaus-ink)] bg-white px-3 text-sm font-semibold text-[#111111] outline-none focus-visible:ring-2 focus-visible:ring-[var(--bauhaus-blue)]"
          />
        </label>
      ) : null}
      <p className="text-[11px] leading-5 text-muted-foreground">
        입금 확인 후 국세청에 발급합니다. 발급되면 주문내역에서 PDF로 받을 수 있습니다.
      </p>
    </fieldset>
  );
}
