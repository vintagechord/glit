"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import { brandStatusTones } from "@/lib/brand-status-tones";
import type { RadioRequestDraft } from "@/lib/radio-request-workspace";

export const radioControlClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base leading-6 text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/25 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/30 sm:text-sm";

// Onside's print look, not a field of blue (owner request 2026-11-26: every
// button was solid blue with white text and the guide felt heavy). The one
// thing to do next on a screen is a yellow ticket with an ink edge; everything
// else is a white ink-outlined button, and reference pages are plain links.
const radioActionClass =
  "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-[10px] border-2 px-3.5 py-2 text-center text-sm font-bold [word-break:keep-all] [overflow-wrap:anywhere] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-950 [&>svg]:shrink-0";

export const radioButtonClass =
  `${radioActionClass} border-[var(--bauhaus-ink)] bg-white text-[#111111] enabled:hover:bg-[#f6f4ee] [&:is(a)]:hover:bg-[#f6f4ee] dark:bg-slate-900 dark:text-slate-100 dark:enabled:hover:bg-slate-800 dark:[&:is(a)]:hover:bg-slate-800`;
export const radioPrimaryClass =
  `${radioActionClass} border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111] shadow-[3px_3px_0_var(--bauhaus-ink)] enabled:hover:-translate-y-px enabled:hover:shadow-[4px_4px_0_var(--bauhaus-ink)] enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-[1px_1px_0_var(--bauhaus-ink)] [&:is(a)]:hover:-translate-y-px [&:is(a)]:hover:shadow-[4px_4px_0_var(--bauhaus-ink)] disabled:shadow-none`;
/** A chosen option (program, story prompt): marked, not shouting. */
export const radioSelectedClass =
  `${radioActionClass} border-[var(--bauhaus-ink)] bg-white text-[#111111] shadow-[inset_0_-4px_0_var(--bauhaus-yellow)] dark:bg-slate-900 dark:text-slate-100 [&>svg]:rounded-[3px] [&>svg]:bg-[var(--bauhaus-yellow)] [&>svg]:p-px [&>svg]:text-[#111111]`;
/** A page on the broadcaster's site to read (program info, playlist, schedule). */
export const radioLinkClass =
  "inline-flex min-h-9 min-w-0 max-w-full items-center gap-1 rounded-[4px] text-xs font-bold text-[#111111] underline decoration-[var(--bauhaus-yellow)] decoration-[3px] underline-offset-[5px] [word-break:keep-all] [overflow-wrap:anywhere] transition hover:decoration-[var(--bauhaus-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 dark:text-slate-100 dark:hover:decoration-slate-100 [&>svg]:shrink-0";
/** What the applicant picked, read back on the page. */
export const radioChoiceNoteClass =
  "rounded-xl border-2 border-[var(--bauhaus-ink)] bg-white px-4 py-3 text-sm font-semibold text-[#111111] dark:bg-slate-900 dark:text-slate-100";
export const radioNoteClass = "text-xs leading-5 text-slate-600 dark:text-slate-300";
export const radioCardClass =
  "min-w-0 rounded-2xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:p-4";

/** User-saved links are navigation only, never trusted as official board URLs. */
export function radioExternalUrl(value?: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function downloadRadioText(text: string) {
  const blob = new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "onside-radio-request.txt";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

type RadioDraftEditorProps = {
  draft: RadioRequestDraft;
  updateDraft: (updater: (current: RadioRequestDraft) => RadioRequestDraft) => void;
  isEnglish: boolean;
  onDownload: () => void;
  readOnly?: boolean;
};

export function RadioDraftEditor({
  draft,
  updateDraft,
  isEnglish,
  onDownload,
  readOnly = false,
}: RadioDraftEditorProps) {
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const combinedRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState({ text: "", snapshot: "" });
  const [manualCopySnapshot, setManualCopySnapshot] = useState("");
  const snapshot = JSON.stringify([draft.title, draft.body]);
  const combined = `${draft.title}\n\n${draft.body}`;
  const showManualCopy = manualCopySnapshot === snapshot;

  useEffect(() => {
    if (!showManualCopy) return;
    combinedRef.current?.focus();
    combinedRef.current?.select();
  }, [manualCopySnapshot, showManualCopy]);

  async function copy(kind: "title" | "body" | "all") {
    const copied = kind === "all" ? combined : draft[kind];
    try {
      await navigator.clipboard.writeText(copied);
      updateDraft(current => {
        if (kind === "all") {
          return `${current.title}\n\n${current.body}` === copied
            ? { ...current, titleCopied: true, bodyCopied: true }
            : current;
        }
        return current[kind] === copied
          ? { ...current, [kind === "title" ? "titleCopied" : "bodyCopied"]: true }
          : current;
      });
      setManualCopySnapshot("");
      setMessage({
        text: kind === "all"
          ? (isEnglish ? "Title and request copied together." : "제목과 본문을 함께 복사했습니다.")
          : (isEnglish ? "Copied. Paste it on the broadcaster’s board." : "복사했습니다. 방송국 게시판에 붙여넣으세요."),
        snapshot,
      });
    } catch {
      if (kind === "all") {
        setManualCopySnapshot(snapshot);
        // Repeated attempts can fail while the same fallback is already open.
        if (showManualCopy) {
          combinedRef.current?.focus();
          combinedRef.current?.select();
        }
      } else {
        const field = kind === "title" ? titleRef.current : bodyRef.current;
        field?.focus();
        field?.select();
      }
      setMessage({
        text: isEnglish ? "Copy the selected text manually." : "선택한 문구를 직접 복사해주세요.",
        snapshot,
      });
    }
  }

  return (
    <section className={readOnly ? "min-w-0" : radioCardClass} aria-labelledby={`${id}-heading`} data-testid="radio-draft-editor">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-slate-100">
          <FileText size={18} className="shrink-0 text-blue-700 dark:text-blue-300" aria-hidden />
          {isEnglish ? "Final request" : "최종 신청글"}
        </h4>
        {readOnly && (
          <span className={`rounded-full border-2 px-2.5 py-1 text-xs font-semibold ${brandStatusTones.progress}`}>
            {isEnglish ? "Prepared request" : "준비한 신청글"}
          </span>
        )}
      </div>
      <div className="space-y-4">
        <div>
          <label htmlFor={`${id}-title`} className="mb-1.5 block text-sm font-semibold">
            {isEnglish ? "Post title" : "게시글 제목"}
          </label>
          <input
            ref={titleRef}
            id={`${id}-title`}
            className={radioControlClass}
            value={draft.title}
            readOnly={readOnly}
            maxLength={300}
            aria-describedby={`${id}-title-count`}
            onChange={event => {
              const title = event.target.value;
              updateDraft(current => ({ ...current, title, titleCopied: false }));
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" className={radioButtonClass} disabled={!draft.title.trim()} onClick={() => void copy("title")}>
              {draft.titleCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              {isEnglish ? "Copy title" : "제목 복사"}
              <span className="sr-only">{draft.titleCopied ? (isEnglish ? " — copied" : " · 복사 완료") : ""}</span>
            </button>
            <span id={`${id}-title-count`} className={`${radioNoteClass} shrink-0 tabular-nums`}>
              {draft.title.length} / 300<span className="sr-only">{isEnglish ? " characters" : "자"}</span>
            </span>
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-semibold">
            {isEnglish ? "Your story and song request" : "사연과 신청곡 문구"}
          </label>
          <textarea
            ref={bodyRef}
            id={`${id}-body`}
            className={`${radioControlClass} resize-y`}
            value={draft.body}
            readOnly={readOnly}
            rows={readOnly ? 6 : 8}
            maxLength={5000}
            aria-describedby={`${id}-body-count`}
            onChange={event => {
              const body = event.target.value;
              updateDraft(current => ({ ...current, body, bodyCopied: false }));
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" className={radioPrimaryClass} disabled={!draft.body.trim()} onClick={() => void copy("body")}>
              {draft.bodyCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              {isEnglish ? "Copy request" : "본문 복사"}
              <span className="sr-only">{draft.bodyCopied ? (isEnglish ? " — copied" : " · 복사 완료") : ""}</span>
            </button>
            <span id={`${id}-body-count`} className={`${radioNoteClass} shrink-0 tabular-nums`}>
              {draft.body.length} / 5000<span className="sr-only">{isEnglish ? " characters" : "자"}</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-4 sm:flex sm:justify-end dark:border-slate-700">
          <button type="button" className={radioButtonClass} disabled={!draft.title.trim() || !draft.body.trim()} onClick={() => void copy("all")}>
            <Copy size={15} aria-hidden />{isEnglish ? "Copy all" : "전체 복사"}
          </button>
          <button type="button" className={radioButtonClass} disabled={!draft.title.trim() || !draft.body.trim()} onClick={onDownload}>
            <Download size={15} aria-hidden />{isEnglish ? "Save as TXT" : "TXT로 저장"}
          </button>
        </div>
        {showManualCopy && (
          <div>
            <label htmlFor={`${id}-combined`} className="mb-1.5 block text-sm font-semibold">
              {isEnglish ? "Title and request to copy manually" : "직접 복사할 제목과 본문"}
            </label>
            <textarea
              ref={combinedRef}
              id={`${id}-combined`}
              value={combined}
              readOnly
              rows={7}
              className={`${radioControlClass} resize-y`}
              onFocus={event => event.currentTarget.select()}
            />
          </div>
        )}
        <p role="status" className={radioNoteClass}>
          {(message.snapshot === snapshot && message.text) || (isEnglish
            ? "Copy title and request separately, or use Copy all for both."
            : "게시판 입력칸에 맞춰 제목·본문을 각각 복사하거나, 전체 복사를 이용하세요.")}
        </p>
      </div>
    </section>
  );
}
