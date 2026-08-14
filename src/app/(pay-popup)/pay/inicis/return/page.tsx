"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { removeGuestSubmissionCartEntries } from "@/lib/guest-submission-cart";

type Status = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

const normalizeStatus = (value: string | null): Status => {
  if (!value) return "ERROR";
  const upper = value.toUpperCase();
  if (upper === "SUCCESS" || upper === "FAIL" || upper === "CANCEL" || upper === "ERROR") {
    return upper;
  }
  return "ERROR";
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseSubmissionIds = (value: string | null) =>
  Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => uuidPattern.test(id)),
    ),
  ).slice(0, 100);

function ReturnBridgeContent() {
  const searchParams = useSearchParams();
  const status = normalizeStatus(searchParams.get("status"));

  const payload = useMemo(
    () => ({
      submissionId: searchParams.get("submissionId"),
      submissionIds: parseSubmissionIds(searchParams.get("submissionIds")),
      requestId: searchParams.get("requestId"),
    }),
    [searchParams],
  );

  useEffect(() => {
    if (status === "SUCCESS" && payload.submissionIds.length > 0) {
      removeGuestSubmissionCartEntries(payload.submissionIds);
    }
    const message = { type: `INICIS:${status}`, payload };
    const hasOpener = typeof window !== "undefined" && !!window.opener && window.opener !== window;
    const buildRedirectTarget = () => {
      const statusParam = status.toLowerCase();
      if (status === "SUCCESS") {
        if (payload.submissionId) {
          return `/dashboard/submissions/${payload.submissionId}?payment=success`;
        }
        if (payload.requestId) {
          return `/karaoke-request?payment=success&requestId=${payload.requestId}`;
        }
      } else {
        if (payload.submissionId) {
          return `/dashboard/submissions/${payload.submissionId}?payment=${statusParam}`;
        }
        if (payload.requestId) {
          return `/karaoke-request?payment=${statusParam}&requestId=${payload.requestId}`;
        }
      }
      return "/";
    };

    try {
      if (hasOpener) {
        window.opener?.postMessage(message, window.location.origin);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, window.location.origin);
      }
    } catch (error) {
      console.error("[Inicis][return-bridge] postMessage error", error);
    }
    if (hasOpener || (window.parent && window.parent !== window)) {
      const timer = window.setTimeout(() => {
        try {
          if (hasOpener) {
            window.close();
          }
        } catch {
          // ignore
        }
      }, 200);
      return () => window.clearTimeout(timer);
    }

    // 모바일/리디렉션 흐름: opener가 없을 때는 최종 페이지로 보내준다.
    const redirectTarget = buildRedirectTarget();
    const timer = window.setTimeout(() => {
      try {
        window.location.replace(redirectTarget);
      } catch {
        window.location.href = redirectTarget;
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [payload, status]);

  const heading =
    status === "SUCCESS"
      ? "결제가 완료되었습니다."
      : status === "CANCEL"
        ? "결제를 취소했습니다."
        : "결제 처리에 실패했습니다.";
  const detail =
    status === "SUCCESS"
      ? "결제 결과를 전달하는 중입니다. 잠시만 기다려주세요."
      : "결제 결과를 전달하는 중입니다. 창을 닫지 말고 기다려주세요.";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-4 py-10 sm:px-6">
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

export default function ReturnBridgePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-white px-4 py-10 sm:px-6">
          <p className="text-sm text-slate-600">결제 결과를 준비 중입니다...</p>
        </div>
      }
    >
      <ReturnBridgeContent />
    </Suspense>
  );
}
