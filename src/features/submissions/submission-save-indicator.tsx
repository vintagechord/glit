"use client";

import * as React from "react";
import {
  Check,
  CloudOff,
  HardDriveDownload,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

import { showCenteredConfirm } from "@/lib/centered-dialog";
import { cn } from "@/lib/utils";

import type { SubmissionCheckpointStatus } from "./use-submission-checkpoint";

const formatSavedTime = (timestamp: number | null) => {
  if (!timestamp) return null;
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return null;
  }
};

export function SubmissionSaveIndicator({
  status,
  lastSavedAt,
  error,
  hasRecovery = false,
  hasPrevious = false,
  onRetry,
  onRecover,
  onDiscardRecovery,
  onRevertToSaved,
  className,
}: {
  status: SubmissionCheckpointStatus;
  lastSavedAt: number | null;
  error?: string | null;
  hasRecovery?: boolean;
  hasPrevious?: boolean;
  onRetry?: () => void | Promise<unknown>;
  onRecover?: () => void;
  onDiscardRecovery?: () => void;
  onRevertToSaved?: () => void;
  className?: string;
}) {
  const recoveryDialogRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (status !== "recovery" || !hasRecovery) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    recoveryDialogRef.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [hasRecovery, status]);

  if (status === "idle") return null;

  const savedTime = formatSavedTime(lastSavedAt);
  const confirmDiscardRecovery = async () => {
    if (
      await showCenteredConfirm(
        "기기에 남아 있는 최신 입력을 지우고 서버 저장본을 사용할까요?",
        { title: "복구본을 사용하지 않음" },
      )
    ) {
      onDiscardRecovery?.();
    }
  };
  const confirmRevert = async () => {
    if (
      await showCenteredConfirm("현재 입력을 이전 저장본으로 되돌릴까요?", {
        title: "이전 저장본 복원",
      })
    ) {
      onRevertToSaved?.();
    }
  };

  if (status === "recovery" && hasRecovery) {
    return (
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6"
      >
        <div
          ref={recoveryDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="submission-recovery-title"
          className={cn(
            "w-full max-w-md rounded-[24px] border-2 border-[#111111] bg-[#fff7cf] p-5 text-[#111111] shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#2a2512] dark:text-white dark:shadow-none",
            className,
          )}
        >
          <div className="flex items-center gap-2 text-xs font-bold">
            <HardDriveDownload aria-hidden="true" className="size-5" />
            <h2 id="submission-recovery-title" className="text-base font-black">
              최근 입력을 복구할까요?
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6">
            서버 저장 이후 이 기기에서 작성한 내용이 남아 있습니다. 먼저 사용할 내용을 선택해주세요.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="min-h-11 rounded-full border border-[#111111] bg-[#111111] px-4 py-2 text-xs font-black text-white dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"
              onClick={onRecover}
            >
              최근 입력 복구
            </button>
            <button
              type="button"
              className="min-h-11 rounded-full border border-[#111111] px-4 py-2 text-xs font-bold dark:border-[#f2cf27]"
              onClick={() => void confirmDiscardRecovery()}
            >
              서버 저장본 사용
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusContent =
    status === "saving" ? (
      <>
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        <span>저장 중</span>
      </>
    ) : status === "error" ? (
      <>
        <CloudOff aria-hidden="true" className="size-3.5" />
        <span title={error || undefined}>저장 실패</span>
      </>
    ) : status === "local" ? (
      <>
        <HardDriveDownload aria-hidden="true" className="size-3.5" />
        <span>기기에 저장됨</span>
      </>
    ) : (
      <>
        <Check aria-hidden="true" className="size-3.5" />
        <span>{savedTime ? `저장됨 · ${savedTime}` : "저장됨"}</span>
      </>
    );

  return (
    <div
      className={cn(
        "flex min-h-8 flex-wrap items-center justify-center gap-2 text-[11px] font-bold text-[#555555] dark:text-white/70",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5">{statusContent}</span>
      {status === "error" && onRetry ? (
        <button
          type="button"
          className="min-h-11 rounded-full border border-current px-3 py-2 font-black text-[#111111] dark:text-[#f2cf27]"
          onClick={() => void onRetry()}
        >
          재시도
        </button>
      ) : null}
      {hasPrevious && onRevertToSaved ? (
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 py-2 font-bold text-[#1556a4] underline underline-offset-2 dark:text-[#71aef2]"
          onClick={() => void confirmRevert()}
        >
          <RotateCcw aria-hidden="true" className="size-3" />
          이전 저장본
        </button>
      ) : null}
    </div>
  );
}
