"use client";

import * as React from "react";

type PendingOverlayProps = {
  show: boolean;
  label?: string;
};

export function PendingOverlay({ show, label }: PendingOverlayProps) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!show) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    previousFocusRef.current?.blur();
    overlayRef.current?.focus();

    const keepFocusInsideOverlay = (event: FocusEvent) => {
      if (
        overlayRef.current &&
        event.target instanceof Node &&
        !overlayRef.current.contains(event.target)
      ) {
        overlayRef.current.focus();
      }
    };
    const blockBackgroundKeyboardNavigation = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key === "Escape") {
        event.preventDefault();
        overlayRef.current?.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInsideOverlay, true);
    document.addEventListener(
      "keydown",
      blockBackgroundKeyboardNavigation,
      true,
    );
    return () => {
      document.removeEventListener("focusin", keepFocusInsideOverlay, true);
      document.removeEventListener(
        "keydown",
        blockBackgroundKeyboardNavigation,
        true,
      );
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [show]);

  if (!show) return null;
  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? "진행 중"}
      aria-busy="true"
      tabIndex={-1}
      className="fixed inset-0 z-[190] flex items-center justify-center bg-black/40 px-4 outline-none backdrop-blur-sm"
    >
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/90 px-5 py-3 text-sm font-semibold text-foreground shadow-xl"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/40 border-t-transparent"
        />
        <span>{label ?? "진행 중..."}</span>
      </div>
    </div>
  );
}
