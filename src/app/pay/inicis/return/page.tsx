"use client";

import { useEffect, useMemo } from "react";
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

export default function InicisReturnBridgePage() {
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
    try {
      if (typeof window !== "undefined") {
        window.opener?.postMessage(message, window.location.origin);
      }
    } catch (error) {
      console.error("[Inicis][return-bridge] postMessage failed", error);
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
      </div>
    </div>
  );
}
