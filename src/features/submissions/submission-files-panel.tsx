"use client";

import * as React from "react";

import { getSubmissionFileUrlAction } from "@/features/submissions/actions";

export type SubmissionFile = {
  id: string;
  kind: string;
  file_path: string;
  original_name: string | null;
  mime: string | null;
  size: number | null;
  created_at: string | null;
};

const kindLabelMap: Record<string, string> = {
  AUDIO: "음원",
  VIDEO: "영상",
  LYRICS: "가사",
  ETC: "기타",
};

const formatFileSize = (size?: number | null) => {
  if (!size || size <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)}${units[idx]}`;
};

export function SubmissionFilesPanel({
  submissionId,
  files,
  guestToken,
  canDownload = true,
}: {
  submissionId: string;
  files: SubmissionFile[];
  guestToken?: string;
  canDownload?: boolean;
}) {
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleDownload = async (fileId: string) => {
    if (!canDownload) return;
    setErrorMessage(null);
    setDownloadingId(fileId);
    const result = await getSubmissionFileUrlAction({
      submissionId,
      fileId,
      guestToken: guestToken || undefined,
    });
    setDownloadingId(null);
    if (result.error) {
      setErrorMessage(result.error);
      return;
    }
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  };

  if (files.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
        첨부된 파일이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div
          key={file.id}
          className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">
                {file.original_name || file.file_path}
              </p>
              <p className="mt-1 text-muted-foreground">
                {kindLabelMap[file.kind] ?? file.kind} · {formatFileSize(file.size)}
              </p>
            </div>
            {canDownload ? (
              <button
                type="button"
                onClick={() => handleDownload(file.id)}
                disabled={downloadingId === file.id}
                className="rounded-full border border-border/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloadingId === file.id ? "다운로드 중" : "다운로드"}
              </button>
            ) : (
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                다운로드는 관리자 전용입니다
              </span>
            )}
          </div>
        </div>
      ))}
      {errorMessage && (
        <p className="text-xs text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}
