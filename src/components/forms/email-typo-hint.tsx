"use client";

import { suggestEmailFix } from "@/lib/email-typo";

/**
 * One line under an application email field when the domain looks mistyped
 * (hanmail.met). Render it right after an input that has the `peer` class:
 * it stays hidden while the field has focus, so it never flickers mid-word,
 * and shows once the customer moves on. It only suggests; nothing is blocked.
 */
export function EmailTypoHint({ email, onApply, className = "" }: { email: string; onApply: (fixed: string) => void; className?: string }) {
  const suggestion = suggestEmailFix(email);
  if (!suggestion) return null;
  const domain = suggestion.slice(suggestion.lastIndexOf("@") + 1);
  return (
    // A span, so it may sit inside a <label> with its input.
    <span className={`flex flex-wrap items-center gap-2 text-xs font-bold text-foreground peer-focus:hidden ${className}`}>
      <span>{`혹시 ${domain}인가요?`}</span>
      <button
        type="button"
        onClick={() => onApply(suggestion)}
        className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-2 py-0.5 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white"
      >
        바꾸기
      </button>
    </span>
  );
}
