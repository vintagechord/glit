"use client";

import * as React from "react";

export function CommerceConfirmDialog({
  title = "삭제 확인", confirmLabel = "삭제", message, acknowledgement, onCancel, onConfirm,
}: {
  title?: string; confirmLabel?: string; message: string;
  /** When set, the confirm button stays disabled until this statement is checked. */
  acknowledgement?: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  const dialogId = React.useId();
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = React.useState(!acknowledgement);
  const [previousFocus] = React.useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  React.useEffect(() => {
    cancelRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [previousFocus]);
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 px-4 py-6" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          if (event.key === "Tab" && event.shiftKey && document.activeElement === cancelRef.current && !acknowledgement) { event.preventDefault(); confirmRef.current?.focus(); }
          if (event.key === "Tab" && !event.shiftKey && document.activeElement === confirmRef.current) { event.preventDefault(); (acknowledgement ? document.getElementById(`${dialogId}-ack`) : cancelRef.current)?.focus(); }
        }}
        className="max-h-[calc(100dvh-3rem)] w-full max-w-sm overflow-y-auto rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-5 text-center text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[6px_6px_0_#f2cf27]">
        <p id={`${dialogId}-title`} className="text-base font-black">{title}</p>
        <p id={`${dialogId}-description`} className="mt-3 whitespace-pre-line text-sm font-semibold leading-6">{message}</p>
        {acknowledgement ? (
          <label className="mt-4 flex items-start justify-center gap-2 text-left text-xs font-black leading-5">
            <input id={`${dialogId}-ack`} type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#111111]" />
            <span>{acknowledgement}</span>
          </label>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" ref={cancelRef} onClick={onCancel} autoFocus className="inline-flex min-h-10 min-w-24 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-xs font-black text-[#111111] transition hover:-translate-y-0.5">취소</button>
          <button type="button" ref={confirmRef} onClick={onConfirm} disabled={!acknowledged} className="inline-flex min-h-10 min-w-24 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[var(--bauhaus-red)] px-4 py-2 text-xs font-black text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:text-[#06111f]">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
