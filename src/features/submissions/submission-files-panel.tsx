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
  ETC: "결제서류/기타",
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
  const [readyFile, setReadyFile] = React.useState<{ id: string; url: string } | null>(null);

  const handleDownload = async (fileId: string) => {
    if (!canDownload || downloadingId) return;
    setErrorMessage(null);
    setReadyFile(null);
    setDownloadingId(fileId);
    // Open during the click, before awaiting the server. Mobile browsers may
    // block a window opened after an async request. A direct link remains usable.
    let pendingWindow: Window | null = null;
    try {
      pendingWindow = window.open("about:blank", "_blank");
      if (pendingWindow) pendingWindow.opener = null;
    } catch { /* A restrictive browser can still use the prepared link below. */ }
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        getSubmissionFileUrlAction({ submissionId, fileId, guestToken: guestToken || undefined }),
        new Promise<never>((_, reject) => {
          requestTimeout = setTimeout(() => reject(new Error("FILE_LOOKUP_TIMEOUT")), 20_000);
        }),
      ]);
      if (result.error) {
        pendingWindow?.close();
        setErrorMessage(result.error);
        return;
      }
      const url = result.url ? new URL(result.url) : null;
      if (!url || !["http:", "https:"].includes(url.protocol)) {
        pendingWindow?.close();
        setErrorMessage("파일 주소를 확인할 수 없습니다.");
        return;
      }
      setReadyFile({ id: fileId, url: url.href });
      if (pendingWindow && !pendingWindow.closed) pendingWindow.location.replace(url.href);
    } catch (error) {
      pendingWindow?.close();
      setErrorMessage(error instanceof Error && error.message === "FILE_LOOKUP_TIMEOUT"
        ? "파일 조회 응답이 지연되고 있습니다. 다시 시도해주세요."
        : "파일을 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      clearTimeout(requestTimeout);
      setDownloadingId(null);
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
              <p data-no-translate className="break-all font-semibold text-foreground">
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
                disabled={downloadingId !== null}
                className="rounded-full border border-border/70 bg-foreground/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/10 dark:bg-transparent dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloadingId === file.id ? "다운로드 중" : "다운로드"}
              </button>
            ) : (
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                다운로드는 관리자 전용입니다
              </span>
            )}
          </div>
          {readyFile?.id === file.id ? (
            <div className="mt-3 text-xs">
              <p role="status" className="text-muted-foreground">파일 링크가 준비되었습니다. 아래 버튼으로 열어주세요.</p>
              <a href={readyFile.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center rounded-full border border-border px-4 py-2 font-semibold underline underline-offset-4">파일 열기</a>
            </div>
          ) : null}
        </div>
      ))}
      {errorMessage && (
        <p role="alert" className="text-xs text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}
