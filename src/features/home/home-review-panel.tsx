"use client";

import * as React from "react";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type StationItem = {
  id: string;
  status: string;
  updated_at: string;
  station?: {
    name?: string | null;
  } | null;
};

type SubmissionSummary = {
  id: string;
  title: string | null;
  status: string;
  updated_at: string;
  payment_status?: string | null;
};

type TabKey = "album" | "mv";

const receptionStatusMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "접수예정",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  },
  SENT: {
    label: "접수",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  RECEIVED: {
    label: "접수",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  APPROVED: {
    label: "접수완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "접수완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  NEEDS_FIX: {
    label: "접수완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
};

const resultStatusMap: Record<string, { label: string; tone: string }> = {
  APPROVED: {
    label: "통과",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "불통과",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "불통과",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
};

const stageStatusMap = {
  payment: {
    label: "결제중",
    tone: "bg-slate-500/10 text-slate-600 dark:text-slate-200",
  },
  paid: {
    label: "결제완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  received: {
    label: "심의 접수완료",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  progress: {
    label: "심의 진행중",
    tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
  },
  completed: {
    label: "전체 심의 완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
};

function getReceptionStatus(status: string) {
  return (
    receptionStatusMap[status] ?? {
      label: "접수",
      tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
    }
  );
}

function getResultStatus(status: string) {
  return (
    resultStatusMap[status] ?? {
      label: "대기",
      tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
    }
  );
}

function getStageStatus(submission?: SubmissionSummary | null) {
  if (!submission) return null;
  const status = submission.status;
  if (["RESULT_READY", "COMPLETED"].includes(status)) {
    return stageStatusMap.completed;
  }
  if (status === "IN_PROGRESS") {
    return stageStatusMap.progress;
  }
  if (["SUBMITTED", "PRE_REVIEW"].includes(status)) {
    return stageStatusMap.received;
  }
  if (submission.payment_status === "PAID") {
    return stageStatusMap.paid;
  }
  return stageStatusMap.payment;
}

export function HomeReviewPanel({
  isLoggedIn,
  albumSubmission,
  mvSubmission,
  albumStations,
  mvStations,
  hideEmptyTabs = false,
  forceLiveBadge = false,
}: {
  isLoggedIn: boolean;
  albumSubmission: SubmissionSummary | null;
  mvSubmission: SubmissionSummary | null;
  albumStations: StationItem[];
  mvStations: StationItem[];
  hideEmptyTabs?: boolean;
  forceLiveBadge?: boolean;
}) {
  const supabase = React.useMemo(
    () => (isLoggedIn ? createClient() : null),
    [isLoggedIn],
  );
  const [tab, setTab] = React.useState<TabKey>(() => {
    if (!hideEmptyTabs) return "album";
    if (albumSubmission) return "album";
    if (mvSubmission) return "mv";
    return "album";
  });
  const normalizeStations = React.useCallback(
    (rows?: StationItem[] | null) =>
      (rows ?? []).map((row) => ({
        ...row,
        station: Array.isArray(row.station) ? row.station[0] : row.station ?? null,
      })),
    [],
  );
  const [albumState, setAlbumState] = React.useState({
    submission: albumSubmission,
    stations: normalizeStations(albumStations),
  });
  const [mvState, setMvState] = React.useState({
    submission: mvSubmission,
    stations: normalizeStations(mvStations),
  });

  const availableTabs = React.useMemo<TabKey[]>(() => {
    if (!hideEmptyTabs) return ["album", "mv"];
    const tabs: TabKey[] = [];
    if (albumState.submission) tabs.push("album");
    if (mvState.submission) tabs.push("mv");
    return tabs.length ? tabs : ["album", "mv"];
  }, [albumState.submission, hideEmptyTabs, mvState.submission]);

  React.useEffect(() => {
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0] ?? "album");
    }
  }, [availableTabs, tab]);

  const active = tab === "album" ? albumState : mvState;
  const activeSubmission = active.submission;
  const activeStations = active.stations;
  const isLive =
    (forceLiveBadge && isLoggedIn) ||
    (isLoggedIn &&
      [albumState.submission, mvState.submission].some(
        (submission) => submission && submission.status !== "COMPLETED",
      ));

  React.useEffect(() => {
    if (!supabase || !activeSubmission?.id) return;
    const channel = supabase
      .channel(`home-submission-${activeSubmission.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `id=eq.${activeSubmission.id}`,
        },
        async () => {
          const { data } = await supabase
            .from("submissions")
            .select("id, title, status, updated_at, payment_status")
            .eq("id", activeSubmission.id)
            .maybeSingle();
          if (!data) return;
          if (tab === "album") {
            setAlbumState((prev) => ({ ...prev, submission: data }));
          } else {
            setMvState((prev) => ({ ...prev, submission: data }));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_reviews",
          filter: `submission_id=eq.${activeSubmission.id}`,
        },
        async () => {
          const { data } = await supabase
            .from("station_reviews")
            .select("id, status, updated_at, station:stations ( name )")
            .eq("submission_id", activeSubmission.id)
            .order("updated_at", { ascending: false });
          if (!data) return;
          if (tab === "album") {
            setAlbumState((prev) => ({
              ...prev,
              stations: normalizeStations(data as StationItem[]),
            }));
          } else {
            setMvState((prev) => ({
              ...prev,
              stations: normalizeStations(data as StationItem[]),
            }));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSubmission?.id, normalizeStations, supabase, tab]);

  const totalCount = activeStations.length;
  const completedCount = activeStations.filter((review) =>
    ["APPROVED", "REJECTED", "NEEDS_FIX"].includes(review.status),
  ).length;
  const isFinalized =
    activeSubmission &&
    ["RESULT_READY", "COMPLETED"].includes(activeSubmission.status);
  const effectiveCompletedCount =
    isFinalized && totalCount > 0 ? totalCount : completedCount;
  const progressPercent =
    totalCount > 0 ? Math.round((effectiveCompletedCount / totalCount) * 100) : 0;
  const progressText =
    totalCount > 0
      ? `진행률 : 총 ${totalCount}곳 중 ${effectiveCompletedCount}곳 완료`
      : "진행률 : 방송국 결과가 등록되면 진행률이 표시됩니다.";
  const currentSubmissionStatus =
    activeSubmission && totalCount > 0 && completedCount === totalCount
      ? stageStatusMap.completed
      : getStageStatus(activeSubmission);

  const rowsPerPage = 5;
  const rowHeight = 40;
  const rowGap = 8;
  const listPadding = 12;
  const pageHeight =
    rowsPerPage * rowHeight + (rowsPerPage - 1) * rowGap + listPadding * 2;
  const [page, setPage] = React.useState(0);
  const [dragOffset, setDragOffset] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStartY = React.useRef<number | null>(null);
  const dragCurrentY = React.useRef(0);
  const maxPage = Math.max(0, Math.ceil(activeStations.length / rowsPerPage) - 1);

  React.useEffect(() => {
    setPage(0);
    setDragOffset(0);
    setIsDragging(false);
  }, [tab, activeStations.length]);

  const clampPage = React.useCallback(
    (value: number) => Math.min(maxPage, Math.max(0, value)),
    [maxPage],
  );

  const handlePrev = React.useCallback(() => {
    setPage((prev) => clampPage(prev - 1));
  }, [clampPage]);

  const handleNext = React.useCallback(() => {
    setPage((prev) => clampPage(prev + 1));
  }, [clampPage]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeStations.length <= rowsPerPage) return;
    dragStartY.current = event.clientY;
    dragCurrentY.current = event.clientY;
    setIsDragging(true);
    setDragOffset(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const delta = event.clientY - dragStartY.current;
    const limit = pageHeight * 0.6;
    dragCurrentY.current = event.clientY;
    setDragOffset(Math.max(-limit, Math.min(limit, delta)));
  };

  const finalizeDrag = React.useCallback(
    (clientY: number) => {
      if (dragStartY.current === null) return;
      const delta = clientY - dragStartY.current;
      const threshold = Math.min(70, pageHeight / 3);
      if (Math.abs(delta) > threshold) {
        setPage((prev) => clampPage(prev + (delta < 0 ? 1 : -1)));
      }
      setDragOffset(0);
      setIsDragging(false);
      dragStartY.current = null;
    },
    [clampPage, pageHeight],
  );

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    finalizeDrag(event.clientY);
  };

  const handlePointerCancel = () => {
    finalizeDrag(dragCurrentY.current);
  };

  const translateY = -(page * pageHeight) + dragOffset;

  return (
    <div className="min-w-0 w-full rounded-[28px] border border-amber-200/60 bg-gradient-to-br from-[#fff2d6]/90 via-white/80 to-[#ffe3a3]/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:border-white/10 dark:from-[#1a1a1a]/70 dark:via-[#111111]/80 dark:to-[#1e1a12]/80 lg:min-h-[520px]">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>나의 심의</span>
        <span className="inline-flex items-center gap-2">
          {isLoggedIn ? (
            <>
              {isLive ? (
                <span className="h-2 w-2 rounded-full bg-rose-500 live-blink" />
              ) : null}
              LIVE
            </>
          ) : (
            "Example"
          )}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-full bg-muted/60 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {availableTabs.includes("album") ? (
          <button
            type="button"
            onClick={() => setTab("album")}
            className={`flex-1 rounded-full px-3 py-2 transition ${
              tab === "album"
                ? "bg-[#f6d64a] text-black shadow-sm"
                : "hover:text-foreground"
            }`}
          >
            앨범
          </button>
        ) : null}
        {availableTabs.includes("mv") ? (
          <button
            type="button"
            onClick={() => setTab("mv")}
            className={`flex-1 rounded-full px-3 py-2 transition ${
              tab === "mv"
                ? "bg-[#f6d64a] text-black shadow-sm"
                : "hover:text-foreground"
            }`}
          >
            뮤직비디오
          </button>
        ) : null}
      </div>

      <div className="mt-6 space-y-5">
        <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 p-4">
          <p className="sr-only">접수 현황</p>
          {activeSubmission ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">
                  {activeSubmission.title || "제목 미입력"}
                </p>
                {currentSubmissionStatus ? (
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ${currentSubmissionStatus.tone}`}
                  >
                    {currentSubmissionStatus.label}
                  </span>
                ) : null}
              </div>
              <div className="rounded-xl border border-border/60 bg-background/80 p-3">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold text-foreground">
                  <span className="truncate">{progressText}</span>
                  {totalCount > 0 ? <span>{progressPercent}%</span> : null}
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-foreground transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm font-semibold text-foreground">
              아직 접수된 내역이 없습니다.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              심의 진행 상황
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={page <= 0}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="이전 심의 진행 상태"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={page >= maxPage}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="다음 심의 진행 상태"
              >
                ↓
              </button>
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-background/70">
            <div className="grid grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <span>방송국</span>
              <span className="justify-self-center text-center">접수 상태</span>
              <span className="justify-self-center text-center">통과 여부</span>
              <span className="text-right">접수 날짜</span>
            </div>
            {activeStations.length > 0 ? (
              <div className="text-xs">
                <div
                  className="relative cursor-grab touch-none active:cursor-grabbing"
                  style={{ height: `${pageHeight}px` }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onPointerLeave={handlePointerCancel}
                >
                  <div
                    className="grid gap-2 py-3"
                    style={{
                      transform: `translateY(${translateY}px)`,
                      transition: isDragging ? "none" : "transform 0.4s ease",
                    }}
                  >
                    {activeStations.map((station, index) => {
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
                </div>
              </div>
            ) : (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                접수 후 방송국 진행 정보를 확인할 수 있습니다.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
