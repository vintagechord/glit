"use client";

import * as React from "react";

import { formatDate, formatDateTime } from "@/lib/format";

type StationReview = {
  id: string;
  status: string;
  updated_at: string | null;
  station?: { name?: string | null } | null;
};

type HistoryItem = {
  id: string;
  order: number;
  title: string;
  artistName: string;
  typeLabel: string;
  createdAt: string | null;
  updatedAt: string | null;
  amountKrw: number | null;
  isOneclick: boolean | null;
  stationReviews: StationReview[];
};

const receptionStatusMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "접수 예정",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  },
  SENT: {
    label: "접수",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  RECEIVED: {
    label: "접수 완료",
    tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
  },
  APPROVED: {
    label: "접수 완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "접수 완료",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "접수 완료",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  },
};

const resultStatusMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  SENT: {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  RECEIVED: {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  APPROVED: {
    label: "통과",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "불통과",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "수정 요청",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  },
};

const getReceptionStatus = (status: string) =>
  receptionStatusMap[status] ?? {
    label: "접수",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  };

const getResultStatus = (status: string) =>
  resultStatusMap[status] ?? {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  };

export function HistoryList({ initialItems }: { initialItems: HistoryItem[] }) {
  const [items, setItems] = React.useState<HistoryItem[]>(initialItems);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isDeleting, startDelete] = React.useTransition();
  const [activeSubmission, setActiveSubmission] =
    React.useState<HistoryItem | null>(null);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = () => {
    if (selectedIds.size === 0 || isDeleting) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("선택한 심의 내역을 삭제할까요?")
    ) {
      return;
    }

    startDelete(async () => {
      setNotice(null);
      const ids = Array.from(selectedIds);
      try {
        const response = await fetch("/api/submissions/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setNotice(
            payload?.error ??
              "선택한 내역 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.",
          );
          return;
        }
      } catch (error) {
        console.error(error);
        setNotice("선택한 내역 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
        아직 접수된 내역이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={selectedIds.size === 0 || isDeleting}
          className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          선택 삭제
        </button>
      </div>
      {notice && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-600">
          {notice}
        </div>
      )}
      {items.map((submission) => (
        <div
          key={submission.id}
          className="grid items-center gap-4 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 text-sm transition hover:border-foreground md:grid-cols-[28px_28px_1fr_auto]"
        >
          <input
            type="checkbox"
            checked={selectedIds.has(submission.id)}
            onChange={() => toggleSelection(submission.id)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-xs text-muted-foreground">
            {submission.order}
          </span>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-200/70 via-white/40 to-indigo-200/60 text-xs font-semibold text-foreground">
              ONS
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {submission.title}
                </p>
                <span
                  className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700"
                >
                  전체 심의 완료
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {submission.artistName} · {submission.typeLabel} ·{" "}
                {formatDateTime(submission.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <button
              type="button"
              onClick={() => setActiveSubmission(submission)}
              className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              상세보기
            </button>
          </div>
        </div>
      ))}

      {activeSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setActiveSubmission(null)}
        >
          <div
            className="w-full max-w-3xl rounded-[32px] border border-border/60 bg-background/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  심의 진행 상황
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-foreground">
                  {activeSubmission.title || "제목 미입력"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeSubmission.artistName || "아티스트 미입력"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubmission(null)}
                className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
              >
                닫기
              </button>
            </div>

            {activeSubmission.isOneclick && (
              <div className="mt-4 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 text-lg font-semibold text-foreground">
                {(activeSubmission.artistName || "아티스트 미입력") +
                  " - " +
                  (activeSubmission.title || "제목 미입력")}
              </div>
            )}

            <div className="mt-4 grid gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-xs text-muted-foreground md:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em]">유형</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {activeSubmission.typeLabel}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  결제 금액
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {activeSubmission.amountKrw
                    ? `${activeSubmission.amountKrw.toLocaleString()}원`
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  접수일
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {formatDateTime(activeSubmission.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  최근 업데이트
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {formatDateTime(activeSubmission.updatedAt)}
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-border/60 bg-background/80">
              <div className="grid grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <span>방송국</span>
                <span className="justify-self-center text-center">접수 상태</span>
                <span className="justify-self-center text-center">통과 여부</span>
                <span className="text-right">접수 날짜</span>
              </div>
              {activeSubmission.stationReviews.length > 0 ? (
                <div className="space-y-2 px-3 py-3 text-xs">
                  {[...activeSubmission.stationReviews]
                    .sort(
                      (a, b) =>
                        new Date(b.updated_at ?? 0).getTime() -
                        new Date(a.updated_at ?? 0).getTime(),
                    )
                    .map((station, index) => {
                      const reception = getReceptionStatus(station.status);
                      const result = getResultStatus(station.status);
                      return (
                        <div
                          key={`${station.id}-${index}`}
                          className="grid h-10 grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-3 text-[11px]"
                        >
                          <span className="truncate font-semibold text-foreground">
                            {station.station?.name ?? "-"}
                          </span>
                          <span
                            className={`inline-flex items-center justify-center justify-self-center rounded-full px-2 py-1 text-[10px] font-semibold ${reception.tone}`}
                          >
                            {reception.label}
                          </span>
                          <span
                            className={`inline-flex items-center justify-center justify-self-center rounded-full px-2 py-1 text-[10px] font-semibold ${result.tone}`}
                          >
                            {result.label}
                          </span>
                          <span className="text-right text-[10px] text-muted-foreground">
                            {formatDate(station.updated_at)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                  접수 후 방송국 진행 정보를 확인할 수 있습니다.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
