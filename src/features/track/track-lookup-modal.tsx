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
            className="w-full max-w-md rounded-[28px] border border-border/60 bg-background p-6 shadow-[0_28px_80px_rgba(15,23,42,0.25)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div>
              {modalTitle ? (
                <p className="text-sm font-semibold text-foreground">
                  {modalTitle}
                </p>
              ) : null}
            </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
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
