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
            className="w-full max-w-md rounded-[10px] border-2 border-[#111111] bg-background p-6 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                {modalTitle ? (
                  <p id={titleId} className="text-sm font-black text-foreground">
                    {modalTitle}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] border-2 border-border px-2 py-1 text-xs font-black text-muted-foreground transition hover:text-foreground"
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
