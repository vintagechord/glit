"use client";

import * as React from "react";

import { TrackLookupForm } from "@/features/track/track-lookup-form";

export function TrackLookupModalTrigger({
  label,
  className,
  modalTitle,
}: {
  label: string;
  className?: string;
  modalTitle?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitle ? titleId : undefined}
            className="w-full max-w-md rounded-[8px] border border-[#cbdde8] bg-white p-6 text-[#2f3a4d] shadow-[0_16px_44px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#111827] dark:text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                {modalTitle ? (
                  <p id={titleId} className="text-sm font-semibold">
                    {modalTitle}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] border border-[#c9d6e8] px-3 py-1 text-xs font-semibold text-[#667085] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f] dark:border-white/16 dark:text-white/70"
              >
                닫기
              </button>
            </div>
            <TrackLookupForm onSuccess={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
