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
  `flex min-h-[108px] w-full items-start gap-3 rounded-[8px] border-2 p-4 text-left shadow-[4px_4px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
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
  const [notice, setNotice] = React.useState<{
    type: "info" | "error";
    message: string;
  } | null>(null);

  const selectPaymentMethod = React.useCallback(
    async (method: PaymentMethod) => {
      if (savingMethod) return;
      setSavingMethod(method);
      setNotice(null);

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
          setNotice({
            type: "error",
            message:
              payload.error ??
              "결제 방식을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
          });
          return;
        }

        setSelectedMethod(method);
        if (method === "BANK") {
          setNotice({
            type: "info",
            message:
              "무통장 입금으로 선택되었습니다. 아래 계좌로 입금하면 관리자가 확인 후 결제 완료 처리합니다.",
          });
        }
      } catch (error) {
        console.error(error);
        setNotice({
          type: "error",
          message: "결제 방식을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
        });
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
            onClick={() => void selectPaymentMethod("BANK")}
            disabled={Boolean(savingMethod)}
            className={methodButtonClass(selectedMethod === "BANK")}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]">
              <Landmark size={18} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-sm font-black">무통장 입금</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-muted-foreground">
                계좌 안내를 확인하고 입금 후 관리자 확인을 기다립니다.
              </span>
              {isSavingBank ? (
                <span className="mt-2 block text-[11px] font-black">
                  저장 중
                </span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void selectPaymentMethod("CARD")}
            disabled={Boolean(savingMethod)}
            className={methodButtonClass(selectedMethod === "CARD")}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]">
              <CreditCard size={18} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-sm font-black">카드 결제</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-muted-foreground">
                KG이니시스 결제 모듈에서 카드 결제를 완료합니다.
              </span>
              {isSavingCard ? (
                <span className="mt-2 block text-[11px] font-black">
                  저장 중
                </span>
              ) : null}
            </span>
          </button>
        </div>
      </div>

      {notice ? (
        <div
          className={`rounded-[8px] border-2 px-4 py-3 text-sm font-semibold ${
            notice.type === "error"
              ? "border-[#d9362c] bg-[#d9362c]/10 text-[#d9362c]"
              : "border-primary/20 bg-primary/8 text-primary dark:border-[#2997ff]/30 dark:bg-[#2997ff]/12 dark:text-[#8bc3ff]"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      {selectedMethod === "BANK" ? (
        <div className="rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-4 text-sm text-foreground shadow-[4px_4px_0_var(--bauhaus-shadow)]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            무통장 입금 안내
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
            입금 후 24시간 내에 결제완료로 전환됩니다. 입금자명이 신청자와 다르면 문의하기로 알려주세요.
          </p>
        </div>
      ) : null}

      {selectedMethod === "CARD" ? (
        <div className="rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-4 shadow-[4px_4px_0_var(--bauhaus-shadow)]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            카드 결제
          </p>
          <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
            카드 결제하기를 누르면 이니시스 결제 모듈이 열립니다. 팝업이 차단된 경우 팝업 해제 후 다시 시도해주세요.
          </p>
          <div className="mt-4">
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
        </div>
      ) : null}
    </div>
  );
}
