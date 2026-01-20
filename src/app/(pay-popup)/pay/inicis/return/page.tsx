"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

type Status = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

const normalizeStatus = (value: string | null): Status => {
  if (!value) return "ERROR";
  const upper = value.toUpperCase();
  if (upper === "SUCCESS" || upper === "FAIL" || upper === "CANCEL" || upper === "ERROR") {
    return upper;
  }
  return "ERROR";
};

function ReturnBridgeContent() {
  const searchParams = useSearchParams();
  const status = normalizeStatus(searchParams.get("status"));

  const payload = useMemo(
    () => {
      const amountRaw = searchParams.get("amount");
      return {
        orderId: searchParams.get("orderId"),
        submissionId: searchParams.get("submissionId"),
        guestToken: searchParams.get("guestToken"),
        message: searchParams.get("message"),
        resultCode: searchParams.get("resultCode"),
        tid: searchParams.get("tid"),
        amount: amountRaw ? Number(amountRaw) : undefined,
      };
    },
    [searchParams],
  );

  useEffect(() => {
    const message = { type: `INICIS:${status}`, payload };
    const canPost = typeof window !== "undefined" && !!window.opener && window.opener !== window;
    try {
      if (canPost) {
        window.opener?.postMessage(message, window.location.origin);
      }
    } catch (error) {
      console.error("[Inicis][return-bridge] postMessage error", error);
    }
    if (!canPost) {
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [payload, status]);

  const heading =
    status === "SUCCESS"
      ? "결제가 완료되었습니다."
      : status === "CANCEL"
        ? "결제를 취소했습니다."
        : "결제 처리에 실패했습니다.";
  const detail =
    payload.message ??
    (status === "SUCCESS"
      ? "결제 결과를 전달하는 중입니다. 잠시만 기다려주세요."
      : "결제 결과를 전달하는 중입니다. 창을 닫지 말고 기다려주세요.");

  const formatPrice = (value?: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? new Intl.NumberFormat("ko-KR").format(value) + "원"
      : "알 수 없음";

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-10">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
          Inicis Payment
        </p>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">{heading}</h1>
        <p className="mt-2 text-sm text-slate-600">{detail}</p>
        <p className="mt-6 text-xs text-slate-500">
          창이 자동으로 닫히지 않으면 수동으로 닫아주세요.
        </p>
        {(payload.orderId || payload.submissionId || payload.tid || payload.amount) && (
          <div className="mt-6 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                주문 정보
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                {status === "SUCCESS"
                  ? "결제성공"
                  : status === "CANCEL"
                    ? "취소"
                    : "실패"}
              </span>
            </div>
            {payload.orderId ? (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">주문번호</span>
                <span className="font-semibold text-slate-900">{payload.orderId}</span>
              </div>
            ) : null}
            {payload.tid ? (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">거래번호(TID)</span>
                <span className="font-medium text-slate-900">{payload.tid}</span>
              </div>
            ) : null}
            {typeof payload.amount === "number" ? (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">결제금액</span>
                <span className="font-semibold text-slate-900">{formatPrice(payload.amount)}</span>
              </div>
            ) : null}
            {payload.resultCode ? (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">결과코드</span>
                <span className="font-medium text-slate-900">{payload.resultCode}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReturnBridgePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white px-6 py-10">
          <p className="text-sm text-slate-600">결제 결과를 준비 중입니다...</p>
        </div>
      }
    >
      <ReturnBridgeContent />
    </Suspense>
  );
}
