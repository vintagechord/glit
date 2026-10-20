import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const approvedReviewResultTone =
  "bg-[#1f7a5a] text-white dark:bg-[#1f7a5a] dark:text-white";
export const rejectedReviewResultTone =
  "bg-[#d9362c] text-white dark:bg-[#d9362c] dark:text-white";

type ReviewResultControlProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "onPointerDown" | "aria-label" | "title"
> & {
  label: string;
  tone: string;
  summary?: string | null;
  className?: string;
};

/** Shared station-result styling for the lookup, home and detail views. */
export function ReviewResultControl({
  label,
  tone,
  summary,
  className,
  onClick,
  ...props
}: ReviewResultControlProps) {
  const resultTone = tone === "bauhaus-status-chip--success"
    ? approvedReviewResultTone
    : tone === "bauhaus-status-chip--danger"
      ? rejectedReviewResultTone
      : tone;
  const classes = cn(
    "inline-flex min-h-11 w-full min-w-[112px] shrink-0 flex-col items-center justify-center rounded-[6px] border-2 border-[#111111] px-3 py-1.5 text-center text-[13px] leading-5 font-black shadow-[2px_2px_0_#111111] dark:border-[#f2cf27] dark:shadow-[2px_2px_0_#f2cf27] sm:w-auto",
    resultTone,
    onClick && "transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0",
    className,
  );
  const content = (
    <>
      <span>{label}</span>
      {summary ? (
        <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
          {summary}
        </span>
      ) : null}
    </>
  );

  return onClick ? (
    <button
      {...props}
      type="button"
      onClick={onClick}
      data-review-result-control
      className={classes}
    >
      {content}
    </button>
  ) : (
    <span title={props.title} data-review-result-control className={classes}>
      {content}
    </span>
  );
}
