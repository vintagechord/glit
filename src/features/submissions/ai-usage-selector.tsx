"use client";

type AiUsageSelectorProps = {
  value: boolean | null;
  onChange: (value: boolean) => void;
  context: "album" | "mv";
};

const contextCopy = {
  album: "작사, 작곡, 편곡, 가사, 음원 제작 등에 생성형 AI를 활용한 경우 선택해주세요.",
  mv: "영상, 이미지, 가사, 작곡, 편집 보조 등에 생성형 AI를 활용한 경우 선택해주세요.",
} as const;

const options = [
  {
    value: false,
    title: "사용 안 함",
  },
  {
    value: true,
    title: "사용함",
  },
] as const;

export function AiUsageSelector({
  value,
  onChange,
  context,
}: AiUsageSelectorProps) {
  return (
    <fieldset className="rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[4px_4px_0_#f2cf27]">
      <legend className="px-1 text-sm font-black text-foreground">
        생성형 AI를 사용했나요? <span aria-hidden="true">*</span>
        <span className="sr-only"> (필수)</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.title}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-12 rounded-[8px] border-2 px-4 py-2 text-left transition ${
                selected
                  ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"
                  : "border-border/70 bg-background text-foreground hover:border-[#111111] dark:hover:border-[#f2cf27]"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[12px] ${
                    selected
                      ? "border-[#111111] bg-[#111111] text-[#f2cf27]"
                      : "border-border bg-background text-transparent"
                  }`}
                  aria-hidden="true"
                >
                  ✓
                </span>
                {option.title}
              </span>
            </button>
          );
        })}
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer font-semibold text-foreground underline-offset-4 hover:underline">
          판단 기준
        </summary>
        <p className="mt-2 break-keep leading-5">
          {contextCopy[context]}
        </p>
      </details>
    </fieldset>
  );
}
