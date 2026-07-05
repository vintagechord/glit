"use client";

type ApplicationFormMode = "online" | "upload";

const buttonBaseClass =
  "min-h-[3.25rem] rounded-[10px] border-2 px-4 py-3 text-center text-sm font-black leading-snug shadow-[2px_2px_0_rgba(17,17,17,0.22)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const buttonIdleClass =
  "border-[#111111]/60 bg-card text-foreground hover:-translate-y-0.5 hover:border-[#111111] hover:bg-[#f2cf27] hover:text-[#111111] hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27]/60 dark:bg-[#171717] dark:text-white dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111] dark:hover:shadow-[4px_4px_0_#f2cf27]";
const onlineActiveClass =
  "border-[#111111] bg-[#111111] text-[#f2cf27] shadow-[3px_3px_0_#f2cf27] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[3px_3px_0_#111111]";
const uploadActiveClass =
  "border-[#111111] bg-[#1556a4] text-white shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[3px_3px_0_#f2cf27]";

const getButtonClass = (isActive: boolean, activeClass: string) =>
  `${buttonBaseClass} ${isActive ? activeClass : buttonIdleClass}`;

export function ApplicationFormModeTabs({
  mode,
  onModeChange,
}: {
  mode: ApplicationFormMode;
  onModeChange: (mode: ApplicationFormMode) => void;
}) {
  const isUploadMode = mode === "upload";

  return (
    <div className="rounded-[18px] border border-border/70 bg-background/70 p-3">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-foreground">
        신청서 접수 방식 · 택 1
      </p>
      <p className="mt-1 text-sm font-semibold leading-6 text-muted-foreground">
        아래 두 방식 중 하나만 선택해서 진행하세요. 온라인 작성과 신청서 파일
        업로드를 동시에 진행할 필요는 없습니다.
      </p>
      <div className="mt-3 grid gap-2 rounded-[14px] bg-background/70 p-1 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onModeChange("online")}
          aria-pressed={mode === "online"}
          className={getButtonClass(mode === "online", onlineActiveClass)}
        >
          온라인 신청서로 접수
        </button>
        <button
          type="button"
          onClick={() => onModeChange("upload")}
          aria-pressed={isUploadMode}
          className={getButtonClass(isUploadMode, uploadActiveClass)}
        >
          신청서 다운로드하여 업로드
        </button>
      </div>
    </div>
  );
}
