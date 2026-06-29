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
    title: "AI 사용 안 함",
    description: "제작 과정에 생성형 AI를 활용하지 않았습니다.",
  },
  {
    value: true,
    title: "AI 활용함",
    description: "일부 또는 전체 제작 과정에 생성형 AI를 활용했습니다.",
  },
] as const;

export function AiUsageSelector({
  value,
  onChange,
  context,
}: AiUsageSelectorProps) {
  return (
    <div className="rounded-2xl border-2 border-[#111111] bg-[#fffaf0] p-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[4px_4px_0_#f2cf27]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#1556a4] dark:text-[#f2cf27]">
            AI 활용 여부 *
          </p>
          <p className="mt-2 break-keep text-sm font-semibold leading-6 text-foreground/72 dark:text-white/76">
            {contextCopy[context]} 방송국 및 영등위 확인 항목입니다.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.title}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-[86px] rounded-[10px] border-2 px-4 py-3 text-left transition ${
                selected
                  ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[4px_4px_0_#f2cf27]"
                  : "border-border/70 bg-background text-foreground hover:border-[#111111] hover:bg-white dark:hover:border-[#f2cf27] dark:hover:bg-[#101010]"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 text-[12px] ${
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
              <span className="mt-2 block break-keep text-xs font-semibold leading-5 opacity-75">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
