"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Radio, X } from "lucide-react";

export function RadioRequestDialog({ open, stationName, isEnglish = false, onClose, returnFocusTarget, children }: {
  open: boolean;
  stationName: string;
  isEnglish?: boolean;
  onClose: () => void;
  returnFocusTarget?: HTMLElement | null;
  children: ReactNode;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = returnFocusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const { body, documentElement } = document;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousBody = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width };
    const previousRootOverflow = documentElement.style.overflow;
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.width = "100%";
    documentElement.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      Object.assign(body.style, previousBody);
      documentElement.style.overflow = previousRootOverflow;
      window.scrollTo(scrollX, scrollY);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, returnFocusTarget]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-modal="true"
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-5xl overflow-hidden rounded-2xl border-2 border-[#111111] bg-card p-0 text-foreground shadow-2xl backdrop:bg-[#071425]/75 backdrop:backdrop-blur-sm sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] dark:border-[#f2cf27]"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
        )).filter(element => {
          if (element.getClientRects().length === 0 || element.closest("[inert]") || getComputedStyle(element).visibility === "hidden") return false;
          // Closed details can retain layout boxes for their descendants even
          // though those controls cannot receive focus. Only its summary can.
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(element)) return false;
          }
          return true;
        });
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
    >
      <div className="flex max-h-[calc(100dvh-1rem-4px)] min-w-0 flex-col sm:max-h-[calc(100dvh-3rem-4px)]">
        <header className="shrink-0 border-b-4 border-[#f2cf27] bg-[#1556a4] p-4 text-white sm:p-6 dark:bg-[#102a49]">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold text-[#ffe97c]"><Radio size={16} aria-hidden />{isEnglish ? "YOUR NEXT STEP" : "심의 이후, 다음 단계"}</p>
              <h2 id={`${id}-title`} className="text-xl font-black leading-snug [overflow-wrap:anywhere] sm:text-2xl">
                <span className="block">{stationName}</span>
                <span className="block">{isEnglish ? "Radio request guide" : "라디오 신청 가이드"}</span>
              </h2>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={isEnglish ? "Close radio request guide" : "라디오 신청 가이드 닫기"} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/40 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2cf27] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1556a4]">
              <X size={22} aria-hidden />
            </button>
          </div>
          <p id={`${id}-description`} className="mt-3 max-w-2xl text-sm leading-relaxed text-white/90">{isEnglish ? "Find the program's participation route, prepare your request, and post it on the broadcaster's site." : "프로그램의 참여 경로를 확인하고 신청 문구를 준비해 방송국 게시판에 직접 올려보세요."}</p>
        </header>
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] sm:p-6" data-testid="radio-guide-scroll">
          {children}
        </div>
      </div>
    </dialog>
  );
}
