"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export type CreditActionNoticeState = {
  type: "success" | "error";
  text: string;
  title?: string;
  actionHref?: string;
  actionLabel?: string;
  clearQueryParams?: string[];
};

export function CreditActionNotice({
  notice,
}: {
  notice: CreditActionNoticeState | null;
}) {
  const [isVisible, setIsVisible] = React.useState(Boolean(notice));
  const titleId = React.useId();
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    setIsVisible(Boolean(notice));
  }, [notice]);

  React.useEffect(() => {
    if (!isVisible || notice?.type !== "success") return;
    confirmButtonRef.current?.focus();
  }, [isVisible, notice?.type]);

  if (!notice || !isVisible) return null;

  if (notice.type === "error") {
    return (
      <div className="mb-5 rounded-[10px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-3 text-sm font-black text-[#d9362c]">
        {notice.text}
      </div>
    );
  }

  const close = () => {
    setIsVisible(false);

    if (
      typeof window === "undefined" ||
      !notice.clearQueryParams ||
      notice.clearQueryParams.length === 0
    ) {
      return;
    }

    const url = new URL(window.location.href);
    notice.clearQueryParams.forEach((param) => url.searchParams.delete(param));
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
      style={{ top: "var(--site-header-height, 76px)" }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-5 text-[#111111] shadow-[6px_6px_0_#111111]"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#1f7a5a] text-white">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-black">
              {notice.title ?? "크레딧 사용 완료"}
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-black/70">
              {notice.text}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {notice.actionHref && notice.actionLabel ? (
            <Link
              href={notice.actionHref}
              className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
            >
              {notice.actionLabel}
            </Link>
          ) : null}
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-2 text-sm font-black text-white shadow-[3px_3px_0_#1556a4] transition hover:-translate-y-0.5"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
