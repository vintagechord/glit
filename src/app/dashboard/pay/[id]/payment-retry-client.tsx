"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { openInicisCardPopup, type InicisPopupContext } from "@/lib/inicis/popup";

type PaymentRetryClientProps = {
  submissionId: string;
  context: InicisPopupContext;
  disabled?: boolean;
};

export function PaymentRetryClient({
  submissionId,
  context,
  disabled = false,
}: PaymentRetryClientProps) {
  const router = useRouter();
  const [isOpening, setIsOpening] = React.useState(false);
  const [notice, setNotice] = React.useState<{
    type: "info" | "error";
    message: string;
  } | null>(null);

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: string }).type;
      const payload = (data as { payload?: Record<string, unknown> }).payload ?? {};
      if (!type || !String(type).startsWith("INICIS:")) return;

      const status = String(type).replace("INICIS:", "");
      if (status === "SUCCESS") {
        router.push(`/dashboard/submissions/${submissionId}?payment=success`);
        return;
      }

      if (status === "FAIL" || status === "CANCEL" || status === "ERROR") {
        const message =
          typeof payload.message === "string"
            ? payload.message
            : status === "CANCEL"
              ? "결제가 취소되었습니다. 접수 내용은 결제 대기 상태로 유지됩니다."
              : "결제가 완료되지 않았습니다. 다시 시도해주세요.";
        setNotice({ type: "error", message });
        setIsOpening(false);
        router.refresh();
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [router, submissionId]);

  const handleRetryPayment = async () => {
    if (isOpening || disabled) return;
    setIsOpening(true);
    setNotice({ type: "info", message: "이니시스 결제 모듈을 준비 중입니다." });
    const { ok, error } = await openInicisCardPopup({
      context,
      submissionId,
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
    setNotice({ type: "info", message: "결제 모듈을 실행했습니다. 결제를 완료해주세요." });
  };

  return (
    <div className="space-y-3">
      {notice ? (
        <div
          className={`rounded-[8px] border-2 px-4 py-3 text-sm font-semibold ${
            notice.type === "error"
              ? "border-[#d9362c] bg-[#d9362c]/10 text-[#d9362c]"
              : "border-[#f2cf27] bg-[#fff8d7] text-[#111111] dark:bg-[#f2cf27]/10 dark:text-[#f2cf27]"
          }`}
        >
          {notice.message}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleRetryPayment}
          disabled={disabled || isOpening}
          className="bauhaus-button px-5 py-3 text-xs uppercase disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isOpening ? "결제 모듈 준비 중" : "카드 결제하기"}
        </button>
        <Link
          href={`/dashboard/submissions/${submissionId}`}
          className="rounded-[8px] border-2 border-border px-5 py-3 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-foreground"
        >
          접수 상세 보기
        </Link>
      </div>
    </div>
  );
}
