"use client";

import { CreditCard, Landmark } from "lucide-react";
import * as React from "react";

import type { InicisPopupContext } from "@/lib/inicis/popup";
import { PaymentRetryClient } from "./payment-retry-client";

type PaymentMethod = "BANK" | "CARD";

type PaymentMethodChoiceClientProps = {
  submissionId: string;
  context: InicisPopupContext;
  guestToken?: string;
  detailHref: string;
  successHref: string;
  paymentState?: string;
  amountLabel: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
};

const methodButtonClass = (active: boolean) =>
  `flex min-h-[72px] w-full items-center gap-3 rounded-[8px] border-2 p-4 text-left shadow-[4px_4px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
    active
      ? "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]"
      : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]"
  }`;

export function PaymentMethodChoiceClient({
  submissionId,
  context,
  guestToken,
  detailHref,
  successHref,
  paymentState,
  amountLabel,
  bankName,
  bankAccount,
  bankHolder,
}: PaymentMethodChoiceClientProps) {
  const [selectedMethod, setSelectedMethod] =
    React.useState<PaymentMethod | null>(() =>
      paymentState ? "CARD" : null,
    );
  const [savingMethod, setSavingMethod] =
    React.useState<PaymentMethod | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const selectPaymentMethod = React.useCallback(
    async (method: PaymentMethod) => {
      if (savingMethod) return;
      setSavingMethod(method);
      setErrorMessage(null);

      try {
        const response = await fetch(
          `/api/submissions/${encodeURIComponent(submissionId)}/payment-method`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method, guestToken }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          setErrorMessage(
            payload.error ??
              "결제 방식을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
          );
          return;
        }

        setSelectedMethod(method);
      } catch (error) {
        console.error(error);
        setErrorMessage(
          "결제 방식을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
        );
      } finally {
        setSavingMethod(null);
      }
    },
    [guestToken, savingMethod, submissionId],
  );

  const isSavingBank = savingMethod === "BANK";
  const isSavingCard = savingMethod === "CARD";

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] p-4">
        <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
          결제 방식 선택
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <button
            type="button"
            aria-pressed={selectedMethod === "BANK"}
            onClick={() => void selectPaymentMethod("BANK")}
            disabled={Boolean(savingMethod)}
            className={methodButtonClass(selectedMethod === "BANK")}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]">
              <Landmark size={18} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-sm font-black">무통장 입금</span>
              {isSavingBank ? (
                <span className="mt-2 block text-[11px] font-black">
                  저장 중
                </span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={selectedMethod === "CARD"}
            onClick={() => void selectPaymentMethod("CARD")}
            disabled={Boolean(savingMethod)}
            className={methodButtonClass(selectedMethod === "CARD")}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]">
              <CreditCard size={18} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-sm font-black">카드 결제</span>
              {isSavingCard ? (
                <span className="mt-2 block text-[11px] font-black">
                  저장 중
                </span>
              ) : null}
            </span>
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-3 text-sm font-semibold text-[#d9362c]">
          {errorMessage}
        </div>
      ) : null}

      {selectedMethod === "BANK" ? (
        <div className="rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-4 text-sm text-foreground shadow-[4px_4px_0_var(--bauhaus-shadow)]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            입금 계좌
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                입금 금액
              </p>
              <p className="mt-1 font-black">{amountLabel}원</p>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                은행
              </p>
              <p className="mt-1 font-semibold">{bankName}</p>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                계좌번호
              </p>
              <p className="mt-1 font-semibold">{bankAccount}</p>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                예금주
              </p>
              <p className="mt-1 font-semibold">{bankHolder}</p>
            </div>
          </div>
          <p className="mt-4 text-xs font-semibold leading-5 text-muted-foreground">
            24시간 내 확인 · 입금자명이 다르면 문의해주세요.
          </p>
        </div>
      ) : null}

      {selectedMethod === "CARD" ? (
        <div className="rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-4 shadow-[4px_4px_0_var(--bauhaus-shadow)]">
          <PaymentRetryClient
            submissionId={submissionId}
            context={context}
            guestToken={guestToken}
            detailHref={detailHref}
            successHref={successHref}
            paymentState={paymentState}
            showDetailLink={false}
          />
        </div>
      ) : null}
    </div>
  );
}
