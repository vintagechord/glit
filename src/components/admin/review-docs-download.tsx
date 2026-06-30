"use client";

import * as React from "react";
import { CheckSquare, Download, Loader2, Square, X } from "lucide-react";

type ReviewDocsSelectionContextValue = {
  availableIds: string[];
  selectedIds: Set<string>;
  toggleId: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
};

const ReviewDocsSelectionContext =
  React.createContext<ReviewDocsSelectionContextValue | null>(null);

const defaultButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-3 py-2 text-xs font-black text-white transition hover:bg-[#1556a4] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]";

const parseMelonUrls = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

function useReviewDocsSelection() {
  const context = React.useContext(ReviewDocsSelectionContext);
  if (!context) {
    throw new Error("ReviewDocsSelectionProvider is required.");
  }
  return context;
}

function parseDownloadFilename(header: string | null, fallback: string) {
  if (!header) return fallback;
  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return fallback;
    }
  }
  const quotedMatch = header.match(/filename="([^"]+)"/i);
  return quotedMatch?.[1] ?? fallback;
}

async function downloadFromResponse(response: Response, fallbackFilename: string) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "심의자료 ZIP 파일을 생성할 수 없습니다.");
  }

  const blob = await response.blob();
  const filename = parseDownloadFilename(
    response.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ReviewDocsSelectionProvider({
  ids,
  children,
}: {
  ids: string[];
  children: React.ReactNode;
}) {
  const availableIds = React.useMemo(() => Array.from(new Set(ids)), [ids]);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    setSelectedIds((current) => {
      const available = new Set(availableIds);
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [availableIds]);

  const toggleId = React.useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = React.useCallback(() => {
    setSelectedIds(new Set(availableIds));
  }, [availableIds]);

  const clear = React.useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const value = React.useMemo(
    () => ({
      availableIds,
      selectedIds,
      toggleId,
      selectAll,
      clear,
    }),
    [availableIds, clear, selectAll, selectedIds, toggleId],
  );

  return (
    <ReviewDocsSelectionContext.Provider value={value}>
      {children}
    </ReviewDocsSelectionContext.Provider>
  );
}

export function ReviewDocsRowCheckbox({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const { selectedIds, toggleId } = useReviewDocsSelection();
  const checked = selectedIds.has(id);

  return (
    <label className="flex items-start gap-2 self-start text-xs font-black text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggleId(id)}
        className="mt-1 h-4 w-4 rounded border-2 border-border accent-[#1556a4]"
        aria-label={`${label} 심의자료 다운로드 선택`}
      />
      <span className="sr-only">{label} 선택</span>
    </label>
  );
}

export function ReviewDocsBulkToolbar() {
  const { availableIds, selectedIds, selectAll, clear } = useReviewDocsSelection();
  const [error, setError] = React.useState("");
  const [isDownloading, setIsDownloading] = React.useState(false);
  const selectedCount = selectedIds.size;
  const allSelected = availableIds.length > 0 && selectedCount === availableIds.length;

  const handleDownload = async () => {
    if (selectedCount === 0) {
      setError("다운로드할 접수를 1건 이상 선택해주세요.");
      return;
    }

    setError("");
    setIsDownloading(true);
    try {
      const response = await fetch("/api/admin/submissions/review-docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      await downloadFromResponse(response, "review-docs.zip");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "심의자료 ZIP 파일을 생성할 수 없습니다.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mt-6 rounded-[10px] border-2 border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            심의자료 다운로드
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            선택 {selectedCount.toLocaleString()}건 / 현재 페이지 {availableIds.length.toLocaleString()}건
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={allSelected ? clear : selectAll}
            disabled={availableIds.length === 0 || isDownloading}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-xs font-black text-foreground transition hover:border-[#111111] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-[#f2cf27]"
          >
            {allSelected ? (
              <CheckSquare className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Square className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{allSelected ? "선택 해제" : "전체 선택"}</span>
          </button>
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={clear}
              disabled={isDownloading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-xs font-black text-foreground transition hover:border-[#111111] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-[#f2cf27]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span>초기화</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDownload}
            disabled={selectedCount === 0 || isDownloading}
            className={defaultButtonClassName}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isDownloading ? "생성 중" : "선택 건 심의자료 ZIP 다운로드"}</span>
          </button>
        </div>
      </div>
      {error ? (
        <p className="mt-3 rounded-[8px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MelonReviewDocsDownloadForm() {
  const [linksText, setLinksText] = React.useState("");
  const [error, setError] = React.useState("");
  const [isDownloading, setIsDownloading] = React.useState(false);
  const melonUrls = React.useMemo(() => parseMelonUrls(linksText), [linksText]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (melonUrls.length === 0) {
      setError("멜론 앨범 링크를 1개 이상 입력해주세요.");
      return;
    }

    setError("");
    setIsDownloading(true);
    try {
      const response = await fetch("/api/admin/review-docs/melon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ melonUrls }),
      });
      await downloadFromResponse(response, "melon-review-docs.zip");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "심의자료 ZIP 파일을 생성할 수 없습니다.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <label className="grid gap-2">
        <span className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
          Melon album links
        </span>
        <textarea
          value={linksText}
          onChange={(event) => setLinksText(event.target.value)}
          rows={4}
          className="min-h-32 w-full resize-y rounded-[10px] border-2 border-border bg-background px-3 py-3 text-sm font-semibold leading-6 text-foreground outline-none transition focus:border-[#1556a4]"
          placeholder={`https://www.melon.com/album/detail.htm?albumId=13760883
https://www.melon.com/album/detail.htm?albumId=12144636`}
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          입력 {melonUrls.length.toLocaleString()}건
        </p>
        <button
          type="submit"
          disabled={melonUrls.length === 0 || isDownloading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#1556a4] px-4 py-2 text-xs font-black text-white shadow-[3px_3px_0_#f2cf27] transition hover:-translate-y-0.5 hover:bg-[#0f488e] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          <span>{isDownloading ? "생성 중" : "전체 심의자료 ZIP 다운로드"}</span>
        </button>
      </div>
      {error ? (
        <p className="rounded-[8px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ReviewDocsSingleDownloadButton({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const [error, setError] = React.useState("");
  const [isDownloading, setIsDownloading] = React.useState(false);

  const handleDownload = async () => {
    setError("");
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/admin/submissions/${id}/review-docs`);
      await downloadFromResponse(response, "review-docs.zip");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "심의자료 ZIP 파일을 생성할 수 없습니다.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading}
        className={className ?? defaultButtonClassName}
      >
        {isDownloading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{isDownloading ? "생성 중" : "심의자료 DOCX ZIP 다운로드"}</span>
      </button>
      {error ? (
        <p className="rounded-[8px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
