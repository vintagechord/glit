"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";
import { readGuestSubmissionCartEntries, rememberGuestSubmissionOrderEntries, removeGuestSubmissionCartEntries } from "@/lib/guest-submission-cart";
import { submissionOrderReturnHref } from "@/lib/inicis/popup-recovery";

/** CHECKING: the card may already be charged but the approval is not
 * confirmed. The customer must not pay again. */
type Status = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR" | "CHECKING";

const normalizeStatus = (value: string | null): Status => {
  if (!value) return "ERROR";
  const upper = value.toUpperCase();
  if (upper === "SUCCESS" || upper === "FAIL" || upper === "CANCEL" || upper === "ERROR" || upper === "CHECKING") {
    return upper;
  }
  return "ERROR";
};

/** Long enough to read the warning before the order list replaces it. */
const CHECKING_REDIRECT_DELAY_MS = 2500;

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
    const orderSubmissionIds = new Set([...payload.submissionIds, ...(payload.submissionId ? [payload.submissionId] : [])]);
    rememberGuestSubmissionOrderEntries(readGuestSubmissionCartEntries().filter(entry => orderSubmissionIds.has(entry.submissionId)));
    if (status === "SUCCESS" && payload.submissionIds.length > 0) {
      removeGuestSubmissionCartEntries(payload.submissionIds);
    }
    const message = { type: `INICIS:${status}`, payload };
    const hasOpener = typeof window !== "undefined" && !!window.opener && window.opener !== window;
    const buildRedirectTarget = () => {
      const statusParam = status.toLowerCase();
      if (payload.submissionId) {
        return `${submissionOrderReturnHref(payload.submissionId)}&payment=${statusParam}`;
      }
      if (status === "SUCCESS") {
        if (payload.requestId) {
          return `/karaoke-request?payment=success&requestId=${payload.requestId}`;
        }
      } else {
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
    if (status === "CHECKING") {
      // Checkout pages built before this outcome ignore its message. After the
      // warning, move the whole tab to the order list, which repeats it. The
      // karaoke page has no such notice, so it keeps this page instead.
      if (!payload.submissionId) return;
      const target = buildRedirectTarget();
      const timer = window.setTimeout(() => {
        try {
          if (hasOpener) {
            window.opener?.location.replace(target);
            window.close();
            return;
          }
          (window.top ?? window).location.replace(target);
        } catch {
          window.location.replace(target);
        }
      }, CHECKING_REDIRECT_DELAY_MS);
      return () => window.clearTimeout(timer);
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
        : status === "CHECKING"
          ? "결제 확인 중입니다. 다시 결제하지 마세요."
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
        {status === "CHECKING" ? (
          <div role="alert" className="mt-4 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] p-4 text-left text-sm leading-6 text-[#111111]">
            <p>카드 승인 결과를 결제사와 확인하고 있습니다. 이미 결제되었을 수 있으니 확인이 끝날 때까지 다시 결제하지 말아주세요. 확인되면 주문내역에 결제 완료 또는 미승인으로 표시됩니다.</p>
            <p className="mt-2 font-semibold">문의: 고객센터 {APP_CONFIG.supportPhone} · {APP_CONFIG.supportEmail}</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">{detail}</p>
            <p className="mt-6 text-xs text-slate-500">
              창이 자동으로 닫히지 않으면 수동으로 닫아주세요.
            </p>
          </>
        )}
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
