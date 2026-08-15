"use client";

import { FilePenLine, Upload } from "lucide-react";

type ApplicationFormMode = "online" | "upload";

const buttonBaseClass =
  "min-h-[3.25rem] rounded-[10px] border-2 px-4 py-3 text-left text-sm font-black leading-snug shadow-[2px_2px_0_rgba(17,17,17,0.22)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
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
    <fieldset className="rounded-[10px] border border-border/70 bg-background/70 p-3">
      <legend className="px-1 text-xs font-black text-foreground">
        작성 방식
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onModeChange("online")}
          aria-pressed={mode === "online"}
          className={getButtonClass(mode === "online", onlineActiveClass)}
        >
          <span className="flex items-center gap-3">
            <FilePenLine className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>온라인 작성</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange("upload")}
          aria-pressed={isUploadMode}
          className={getButtonClass(isUploadMode, uploadActiveClass)}
        >
          <span className="flex items-center gap-3">
            <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>파일로 제출</span>
          </span>
        </button>
      </div>
    </fieldset>
  );
}
