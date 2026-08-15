type SubmissionProgressProps = {
  steps: readonly string[];
  currentStep: number;
};

export function SubmissionProgress({
  steps,
  currentStep,
}: SubmissionProgressProps) {
  const safeStep = Math.min(Math.max(currentStep, 1), steps.length);

  return (
    <nav
      aria-label="신청 진행 단계"
      className="rounded-[10px] border-2 border-[#111111] bg-card px-4 py-3 shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-black text-foreground">
          {steps[safeStep - 1]}
        </p>
        <span className="shrink-0 text-xs font-black tabular-nums text-muted-foreground">
          {safeStep} / {steps.length}
        </span>
      </div>
      <ol
        className="mt-3 grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        }}
        aria-label="전체 진행률"
      >
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const reached = stepNumber <= safeStep;
          const current = stepNumber === safeStep;
          return (
            <li
              key={label}
              className="min-w-0"
              aria-current={current ? "step" : undefined}
            >
              <span
                className={`block h-2 rounded-full border ${
                  reached
                    ? "border-[#111111] bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27]"
                    : "border-border bg-muted"
                }`}
                aria-hidden="true"
              />
              <span className="sr-only">
                {stepNumber}. {label}{current ? " (현재 단계)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
