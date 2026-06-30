"use client";

import * as React from "react";
import { Loader2, MessageSquareText, SendHorizontal, X } from "lucide-react";

type SupportInquiryModalProps = {
  className?: string;
};

type InquiryResponse = {
  ok?: boolean;
  error?: string;
};

const fieldClass =
  "w-full rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]";

export function SupportInquiryModal({ className }: SupportInquiryModalProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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

  const resetForm = () => {
    setTitle("");
    setBody("");
    setContact("");
    setError(null);
    setSubmitted(false);
  };

  const closeModal = () => {
    setOpen(false);
  };

  const submitInquiry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/support/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, contact }),
      });
      const payload = (await response.json().catch(() => null)) as
        | InquiryResponse
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "문의 접수 중 오류가 발생했습니다.");
      }
      setSubmitted(true);
      setTitle("");
      setBody("");
      setContact("");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "문의 접수 중 오류가 발생했습니다.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
        className={className}
      >
        <MessageSquareText className="h-4 w-4" aria-hidden="true" />
        1:1 문의
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[min(720px,calc(100vh-48px))] w-full max-w-lg overflow-y-auto rounded-[12px] border-2 border-[#111111] bg-card shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b-2 border-[#111111] bg-[#111111] px-5 py-4 text-white dark:border-[#f2cf27]">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/60">
                  Support
                </p>
                <h2 id={titleId} className="mt-1 text-lg font-black">
                  1:1 문의
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-white/30 text-white transition hover:bg-white hover:text-[#111111]"
                aria-label="문의 모달 닫기"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {submitted ? (
              <div className="px-5 py-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#111111] bg-[#f2cf27] text-lg font-black text-[#111111]">
                  ✓
                </div>
                <p className="mt-4 text-lg font-black text-foreground">
                  문의가 접수되었습니다.
                </p>
                <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                  남겨주신 연락처로 확인 후 안내드리겠습니다.
                </p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 text-xs font-black text-white transition hover:bg-[#1556a4]"
                >
                  확인
                </button>
              </div>
            ) : (
              <form onSubmit={submitInquiry} className="space-y-4 px-5 py-5">
                <label className="grid gap-1 text-xs font-black text-muted-foreground">
                  제목
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    maxLength={120}
                    placeholder="문의 제목을 입력하세요."
                    className={fieldClass}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black text-muted-foreground">
                  내용
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    required
                    maxLength={4000}
                    rows={7}
                    placeholder="문의 내용을 입력하세요."
                    className={`${fieldClass} resize-y leading-6`}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black text-muted-foreground">
                  이메일 또는 연락처
                  <input
                    value={contact}
                    onChange={(event) => setContact(event.target.value)}
                    required
                    maxLength={160}
                    placeholder="답변받을 이메일 또는 전화번호"
                    className={fieldClass}
                  />
                </label>

                {error ? (
                  <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600">
                    {error}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="inline-flex h-10 items-center justify-center rounded-[8px] border-2 border-border px-4 text-xs font-black text-muted-foreground transition hover:border-[#111111] hover:text-foreground"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={sending || !title.trim() || !body.trim() || !contact.trim()}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-xs font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                    )}
                    문의 접수
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
