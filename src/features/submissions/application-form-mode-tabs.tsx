"use client";

import { FilePenLine, Upload } from "lucide-react";

type ApplicationFormMode = "online" | "upload";

const buttonBaseClass =
  "min-h-[7rem] rounded-[16px] border-2 p-4 text-left text-sm font-black leading-snug shadow-[2px_2px_0_rgba(17,17,17,0.22)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70 sm:p-5";
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
  disabled = false,
}: {
  mode: ApplicationFormMode | null;
  onModeChange: (mode: ApplicationFormMode) => void;
  disabled?: boolean;
}) {
  const isUploadMode = mode === "upload";

  return (
    <fieldset
      aria-describedby="application-form-mode-help"
      className="rounded-[20px] border-2 border-[#111111] bg-card p-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:p-6"
    >
      <legend className="sr-only">
        작성 방식 선택
      </legend>
      <p
        id="application-form-mode-help"
        className="mb-4 text-sm font-semibold text-muted-foreground"
      >
        두 방식 중 하나만 선택하세요.
      </p>
      <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onModeChange("online")}
          disabled={disabled}
          role="radio"
          aria-checked={mode === "online"}
          className={getButtonClass(mode === "online", onlineActiveClass)}
        >
          <span className="flex items-start justify-between gap-4">
            <span className="flex items-start gap-3">
              <FilePenLine className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block">온라인 작성</span>
                <span className="mt-1 block text-xs font-semibold opacity-75">
                  사이트에서 직접 입력
                </span>
              </span>
            </span>
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-current text-xs"
            >
              {mode === "online" ? "✓" : ""}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange("upload")}
          disabled={disabled}
          role="radio"
          aria-checked={isUploadMode}
          className={getButtonClass(isUploadMode, uploadActiveClass)}
        >
          <span className="flex items-start justify-between gap-4">
            <span className="flex items-start gap-3">
              <Upload className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block">파일로 제출</span>
                <span className="mt-1 block text-xs font-semibold opacity-75">
                  양식을 내려받아 작성 후 첨부
                </span>
              </span>
            </span>
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-current text-xs"
            >
              {isUploadMode ? "✓" : ""}
            </span>
          </span>
        </button>
      </div>
    </fieldset>
  );
}
