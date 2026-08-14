"use client";

import * as React from "react";

import {
  CENTERED_DIALOG_REQUEST_EVENT,
  showCenteredAlert,
  type CenteredDialogRequest,
} from "@/lib/centered-dialog";

export function CenteredDialogHost() {
  const [queue, setQueue] = React.useState<CenteredDialogRequest[]>([]);
  const active = queue[0] ?? null;
  const primaryButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent<CenteredDialogRequest>).detail;
      if (!detail?.id || typeof detail.resolve !== "function") return;
      setQueue((current) => [...current, detail]);
    };
    const originalAlert = window.alert;
    const centeredAlert = (message?: unknown) => {
      void showCenteredAlert(message);
    };

    window.addEventListener(CENTERED_DIALOG_REQUEST_EVENT, handleRequest);
    document.documentElement.dataset.centeredDialogReady = "true";
    window.alert = centeredAlert;

    return () => {
      window.removeEventListener(CENTERED_DIALOG_REQUEST_EVENT, handleRequest);
      delete document.documentElement.dataset.centeredDialogReady;
      if (window.alert === centeredAlert) {
        window.alert = originalAlert;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!active) return;
    primaryButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      active.resolve(active.kind === "alert");
      setQueue((current) => current.slice(1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  if (!active) return null;

  const finish = (confirmed: boolean) => {
    active.resolve(confirmed);
    setQueue((current) => current.slice(1));
  };
  const isConfirm = active.kind === "confirm";
  const title =
    active.title ?? (isConfirm ? "확인해주세요." : "안내");

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4 py-6"
      role="presentation"
    >
      <div
        role={isConfirm ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`centered-dialog-title-${active.id}`}
        aria-describedby={`centered-dialog-message-${active.id}`}
        className="w-full max-w-sm rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-5 text-center text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[6px_6px_0_#f2cf27]"
      >
        <p
          id={`centered-dialog-title-${active.id}`}
          className="text-base font-black"
        >
          {title}
        </p>
        <p
          id={`centered-dialog-message-${active.id}`}
          className="mt-3 whitespace-pre-line break-keep text-sm font-semibold leading-6"
        >
          {active.message}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {isConfirm ? (
            <button
              type="button"
              onClick={() => finish(false)}
              className="inline-flex h-10 min-w-24 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-4 text-xs font-black text-[#111111] transition hover:-translate-y-0.5"
            >
              취소
            </button>
          ) : null}
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={() => finish(true)}
            className="inline-flex h-10 min-w-24 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[var(--bauhaus-red)] px-4 text-xs font-black text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 dark:text-[#06111f]"
          >
            {isConfirm ? "확인" : "닫기"}
          </button>
        </div>
      </div>
    </div>
  );
}
