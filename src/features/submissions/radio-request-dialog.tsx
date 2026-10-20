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
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-5xl overflow-hidden rounded-[1rem] border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl shadow-slate-950/20 backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100%-3rem)] sm:rounded-[1.5rem] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
      <div className="flex max-h-[calc(100dvh-1rem-2px)] min-w-0 flex-col sm:max-h-[calc(100dvh-4rem-2px)]">
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-7 sm:py-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-title`} className="[overflow-wrap:anywhere]">
                <span className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-[#1556a4] dark:text-blue-300"><Radio size={14} className="shrink-0" aria-hidden />{stationName}</span>
                <span className="block text-lg font-bold leading-tight tracking-tight sm:text-xl">{isEnglish ? "Radio request guide" : "라디오 신청 가이드"}</span>
              </h2>
              <p id={`${id}-description`} className="sr-only">{isEnglish ? "Choose your song and program, prepare the request, and post it on the official site." : "곡과 프로그램 선택부터 신청글 준비, 공식 게시판 등록까지 안내합니다."}</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={isEnglish ? "Close radio request guide" : "라디오 신청 가이드 닫기"} className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-slate-950">
              <X size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </header>
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-3 py-4 [overflow-wrap:anywhere] sm:px-7 sm:py-6" data-testid="radio-guide-scroll">
          {children}
        </div>
      </div>
    </dialog>
  );
}
