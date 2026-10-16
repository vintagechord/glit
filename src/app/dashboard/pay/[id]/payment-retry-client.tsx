"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { getInicisMobileBrowser, getInicisServerDevice, subscribeToInicisDevice, INICIS_MOBILE_UNAVAILABLE_MESSAGE } from "@/lib/inicis/device";

import {
  cleanupInicisPaymentLayer,
  openInicisCardPopup,
  type InicisPopupContext,
} from "@/lib/inicis/popup";

type PaymentRetryClientProps = {
  submissionId: string;
  context: InicisPopupContext;
  guestToken?: string;
  detailHref: string;
  successHref: string;
  paymentState?: string;
  disabled?: boolean;
  showDetailLink?: boolean;
};

const normalizeInicisStatus = (type: string) => {
  const rawStatus = type.replace("INICIS:", "").toUpperCase();
  if (rawStatus.startsWith("SUCCESS")) return "SUCCESS";
  if (rawStatus.startsWith("CANCEL")) return "CANCEL";
  if (rawStatus.startsWith("FAIL")) return "FAIL";
  if (rawStatus.startsWith("ERROR")) return "ERROR";
  return rawStatus;
};

const getInitialNotice = (paymentState?: string) => {
  const normalized = paymentState?.toLowerCase();
  if (normalized === "cancel") {
    return {
      type: "error" as const,
      message: "결제가 취소되었습니다.",
    };
  }
  if (normalized === "fail" || normalized === "error") {
    return {
      type: "error" as const,
      message: "결제에 실패했습니다.",
    };
  }
  return null;
};

export function PaymentRetryClient({
  submissionId,
  context,
  guestToken,
  detailHref,
  successHref,
  paymentState,
  disabled = false,
  showDetailLink = true,
}: PaymentRetryClientProps) {
  const router = useRouter();
  const isMobileDevice = React.useSyncExternalStore(subscribeToInicisDevice, getInicisMobileBrowser, getInicisServerDevice);
  const [isOpening, setIsOpening] = React.useState(false);
  const [notice, setNotice] = React.useState<{
    type: "info" | "error";
    message: string;
  } | null>(() => getInitialNotice(paymentState));

  const reloadPaymentPage = React.useCallback((nextPaymentState: string) => {
    if (typeof window === "undefined") {
      router.refresh();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("payment", nextPaymentState);
    url.searchParams.set("reloadedAt", String(Date.now()));
    window.location.replace(url.toString());
  }, [router]);

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: string }).type;
      const payload = (data as { payload?: Record<string, unknown> }).payload ?? {};
      if (!type || !String(type).startsWith("INICIS:")) return;

      const status = normalizeInicisStatus(String(type));
      cleanupInicisPaymentLayer();
      if (status === "SUCCESS") {
        router.push(successHref);
        return;
      }

      if (status === "FAIL" || status === "CANCEL" || status === "ERROR") {
        const paymentState = status.toLowerCase();
        const message =
          typeof payload.message === "string"
            ? payload.message
            : status === "CANCEL"
              ? "결제가 취소되었습니다."
              : "결제에 실패했습니다.";
        setNotice({ type: "error", message });
        setIsOpening(false);
        window.setTimeout(() => reloadPaymentPage(paymentState), 80);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [reloadPaymentPage, router, submissionId, successHref]);

  const handleRetryPayment = async () => {
    if (isOpening || disabled) return;
    setIsOpening(true);
    setNotice(null);
    const { ok, error } = await openInicisCardPopup({
      context,
      submissionId,
      guestToken,
    });
    if (!ok) {
      setNotice({
        type: "error",
        message:
          error || "결제 모듈을 실행하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
      setIsOpening(false);
      return;
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      {isMobileDevice ? <p className="text-sm leading-6 text-muted-foreground">{INICIS_MOBILE_UNAVAILABLE_MESSAGE}</p> : null}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={handleRetryPayment}
          disabled={disabled || isOpening || isMobileDevice}
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-5 py-3 text-xs font-black uppercase tracking-normal text-white shadow-[3px_3px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 hover:bg-[#b92d25] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 dark:text-[#06111f] dark:hover:bg-[#ff7a72]"
        >
          {isOpening ? "결제 준비 중" : isMobileDevice ? "카드 결제 · PC에서 이용" : "카드 결제하기"}
        </button>
        {showDetailLink ? (
          <Link
            href={detailHref}
            className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-border px-5 py-3 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-foreground"
          >
            접수 상세 보기
          </Link>
        ) : null}
      </div>
    </div>
  );
}
