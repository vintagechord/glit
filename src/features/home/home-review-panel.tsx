"use client";

import Link from "next/link";
import Image from "next/image";
import * as React from "react";
import { formatDate } from "@/lib/format";
import { summarizeTrackResults } from "@/lib/track-results";
import { createClient } from "@/lib/supabase/client";

type StationItem = {
  id: string;
  status: string;
  updated_at: string;
  track_results?: unknown;
  station?: {
    id?: string | null;
    name?: string | null;
    code?: string | null;
    logo_url?: string | null;
  } | null;
};

type SubmissionSummary = {
  id: string;
  title: string | null;
  artist_name?: string | null;
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
    label: "결제대기",
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

function getResultStatus(review: StationItem) {
  const summary = summarizeTrackResults(review.track_results);
  const base =
    summary.outcome === "APPROVED"
      ? resultStatusMap.APPROVED
      : summary.outcome === "REJECTED"
        ? resultStatusMap.REJECTED
        : summary.outcome === "PARTIAL"
          ? {
              label: "부분 통과",
              tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
            }
          : resultStatusMap[review.status] ?? {
              label: "대기",
              tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
            };

  const summaryText =
    summary.counts.total > 1
      ? `${summary.counts.approved}곡 통과 / ${summary.counts.rejected}곡 불통과${
          summary.counts.pending > 0 ? ` / ${summary.counts.pending}곡 대기` : ""
        }`
      : null;

  return { ...base, summaryText };
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

function getSubmissionLabels(submission?: SubmissionSummary | null) {
  if (!submission) {
    return {
      artist: "아티스트 미입력",
      title: "제목 미입력",
      summary: "나의 심의",
    };
  }
  const artist = submission.artist_name?.trim() || "아티스트 미입력";
  const title = submission.title?.trim() || "제목 미입력";
  return {
    artist,
    title,
    summary: `${artist} - ${title}`,
  };
}

const stationBadgeMap: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  KBS: { label: "KBS", color: "#0c4da2", bg: "#e2ecf9" },
  "KBS 1FM": { label: "KBS", color: "#0c4da2", bg: "#e2ecf9" },
  "KBS 2FM": { label: "KBS", color: "#0c4da2", bg: "#e2ecf9" },
  MBC: { label: "MBC", color: "#0c2e63", bg: "#e1e7f7" },
  "MBC FM4U": { label: "MBC", color: "#0c2e63", bg: "#e1e7f7" },
  "MBC 표준FM": { label: "MBC", color: "#0c2e63", bg: "#e1e7f7" },
  SBS: { label: "SBS", color: "#1b74e4", bg: "#e4efff" },
  "SBS 파워FM": { label: "SBS", color: "#1b74e4", bg: "#e4efff" },
  "SBS 러브FM": { label: "SBS", color: "#1b74e4", bg: "#e4efff" },
  TBS: { label: "TBS", color: "#0a9389", bg: "#dbf4f1" },
  "TBS eFM": { label: "TBS", color: "#0a9389", bg: "#dbf4f1" },
  YTN: { label: "YTN", color: "#0d74b7", bg: "#e3f2fb" },
  CBS: { label: "CBS", color: "#1c6ac9", bg: "#e1edff" },
  BBS: { label: "BBS", color: "#7b3f98", bg: "#f2e9fb" },
  WBS: { label: "WBS", color: "#0f6b4f", bg: "#e4f5ee" },
  PBC: { label: "PBC", color: "#a4002f", bg: "#fbe7ed" },
  FEBC: { label: "FEBC", color: "#d97706", bg: "#fff4e5" },
  ARIRANG: { label: "ARIRANG", color: "#d00023", bg: "#fde6ea" },
  "GYEONGIN IFM": { label: "gfm", color: "#2563eb", bg: "#e0ebff" },
  TBN: { label: "TBN", color: "#0ea5e9", bg: "#e0f7ff" },
  KISS: { label: "KISS", color: "#15803d", bg: "#e4f6ea" },
  GUGAK: { label: "GUGAK", color: "#92400e", bg: "#f7efe6" },
  EBS: { label: "EBS", color: "#0d6e8d", bg: "#e1edf5" },
  TVN: { label: "TVN", color: "#d90429", bg: "#fde8ec" },
  JTBC: { label: "JTBC", color: "#ff7f50", bg: "#fff0e8" },
  G1: { label: "G1", color: "#2563eb", bg: "#e0ebff" },
};

const stationLogoSources: Array<{
  patterns: string[];
  src: string;
  alt: string;
}> = [
  { patterns: ["KBS", "KBS 1FM", "KBS 2FM"], src: "/station-logos/kbs.svg", alt: "KBS" },
  { patterns: ["MBC", "MBC FM4U", "MBC 표준FM"], src: "/station-logos/mbc.svg", alt: "MBC" },
  { patterns: ["SBS", "SBS 파워FM", "SBS 러브FM"], src: "/station-logos/sbs.svg", alt: "SBS" },
  { patterns: ["TBS", "TBS EFM"], src: "/station-logos/tbs.svg", alt: "TBS" },
  { patterns: ["YTN"], src: "/station-logos/ytn.svg", alt: "YTN" },
  { patterns: ["CBS"], src: "/station-logos/cbs.svg", alt: "CBS" },
  { patterns: ["BBS"], src: "/station-logos/bbs.svg", alt: "BBS 불교방송" },
  { patterns: ["WBS"], src: "/station-logos/wbs.svg", alt: "WBS" },
  { patterns: ["PBC"], src: "/station-logos/pbc.svg", alt: "PBC 평화방송" },
  { patterns: ["FEBC"], src: "/station-logos/febc.svg", alt: "FEBC 극동방송" },
  { patterns: ["ARIRANG"], src: "/station-logos/arirang.svg", alt: "Arirang" },
  { patterns: ["GYEONGIN IFM", "KFM", "IFM"], src: "/station-logos/ifm.svg", alt: "경인방송 iFM" },
  { patterns: ["TBN"], src: "/station-logos/tbn.svg", alt: "TBN" },
  { patterns: ["KISS"], src: "/station-logos/kiss.svg", alt: "KISS" },
  { patterns: ["GUGAK"], src: "/station-logos/gugak.svg", alt: "국악방송" },
  { patterns: ["EBS"], src: "/station-logos/ebs.svg", alt: "EBS" },
  { patterns: ["TVN"], src: "/station-logos/tvn.svg", alt: "tvN" },
  { patterns: ["JTBC"], src: "/station-logos/jtbc.svg", alt: "JTBC" },
  { patterns: ["G1", "GFM"], src: "/station-logos/g1.svg", alt: "G1" },
];

const completionStatusSet = new Set(["APPROVED", "REJECTED", "NEEDS_FIX"]);

const isStationCompleted = (review: StationItem) => {
  const summary = summarizeTrackResults(review.track_results);
  if (summary.outcome && summary.outcome !== "PENDING") {
    return true;
  }
  return completionStatusSet.has(review.status);
};

function StationLogo({
  station,
  hideOnMobile = false,
}: {
  station?: { name?: string | null; code?: string | null; logo_url?: string | null } | null;
  hideOnMobile?: boolean;
}) {
  const key = (station?.name ?? station?.code ?? "").trim().toUpperCase();
  const visibilityClass = hideOnMobile ? "hidden sm:inline-flex" : "inline-flex";
  const fallbackLocal = "/station-logos/default.svg";

  const mappedLogo = stationLogoSources.find((entry) =>
    entry.patterns.some(
      (pattern) => key === pattern || key.startsWith(pattern),
    ),
  );

  const initialSrc = station?.logo_url ?? mappedLogo?.src ?? null;
  const [src, setSrc] = React.useState<string | null>(initialSrc);

  React.useEffect(() => {
    setSrc(initialSrc);
  }, [initialSrc]);

  const handleError = React.useCallback(() => {
    if (src && src !== mappedLogo?.src && mappedLogo?.src) {
      setSrc(mappedLogo.src);
      return;
    }
    if (src !== fallbackLocal) {
      setSrc(fallbackLocal);
      return;
    }
    setSrc(null);
  }, [mappedLogo?.src, src]);

  if (src) {
    return (
      <span className={`${visibilityClass} h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-white shadow-sm`}>
        <Image
          src={src}
          alt={station?.name ?? station?.code ?? "station logo"}
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
          unoptimized
          loading="lazy"
          onError={handleError}
        />
      </span>
    );
  }

  const badge = stationBadgeMap[key] ?? { label: key || "-", color: "#111", bg: "#e5e7eb" };
  return (
    <span
      className={`${visibilityClass} h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold uppercase`}
      style={{ color: badge.color, backgroundColor: badge.bg }}
      aria-hidden
    >
      {badge.label.slice(0, 4)}
    </span>
  );
}

export function HomeReviewPanel({
  isLoggedIn,
  albumSubmissions,
  mvSubmissions,
  albumStationsMap,
  mvStationsMap,
  hideEmptyTabs = false,
  forceLiveBadge = false,
}: {
  isLoggedIn: boolean;
  albumSubmissions: SubmissionSummary[];
  mvSubmissions: SubmissionSummary[];
  albumStationsMap: Record<string, StationItem[]>;
  mvStationsMap: Record<string, StationItem[]>;
  hideEmptyTabs?: boolean;
  forceLiveBadge?: boolean;
}) {
  const supabase = React.useMemo(
    () => (isLoggedIn ? createClient() : null),
    [isLoggedIn],
  );
  const albumList = albumSubmissions;
  const mvList = mvSubmissions;
  const [tab, setTab] = React.useState<TabKey>(() => {
    if (!hideEmptyTabs) return "album";
    if (albumList.length > 0) return "album";
    if (mvList.length > 0) return "mv";
    return "album";
  });
  const normalizeStations = React.useCallback((rows?: StationItem[] | null) => {
    return (rows ?? []).map((row) => ({
      ...row,
      station: Array.isArray(row.station) ? row.station[0] : row.station ?? null,
    }));
  }, []);
  const [albumState, setAlbumState] = React.useState(() => ({
    submissions: albumList,
    stationsById: albumStationsMap,
    index: 0,
  }));
  const [mvState, setMvState] = React.useState(() => ({
    submissions: mvList,
    stationsById: mvStationsMap,
    index: 0,
  }));

  const availableTabs = React.useMemo<TabKey[]>(() => {
    if (!hideEmptyTabs) return ["album", "mv"];
    const tabs: TabKey[] = [];
    if (albumState.submissions.length > 0) tabs.push("album");
    if (mvState.submissions.length > 0) tabs.push("mv");
    return tabs.length ? tabs : ["album", "mv"];
  }, [albumState.submissions.length, hideEmptyTabs, mvState.submissions.length]);

  React.useEffect(() => {
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0] ?? "album");
    }
  }, [availableTabs, tab]);

  const activeList = tab === "album" ? albumState.submissions : mvState.submissions;
  const activeIndex = tab === "album" ? albumState.index : mvState.index;
  const activeStationsMap = tab === "album" ? albumState.stationsById : mvState.stationsById;
  const activeSubmission =
    activeList.length > 0 ? activeList[Math.min(activeIndex, activeList.length - 1)] : null;
  const activeSubmissionId = activeSubmission?.id;
  const activeStations = activeSubmissionId
    ? activeStationsMap[activeSubmissionId] ?? []
    : [];
  const submissionLabels = getSubmissionLabels(activeSubmission);
  const isLive =
    (forceLiveBadge && isLoggedIn) ||
    (isLoggedIn &&
      [...albumState.submissions, ...mvState.submissions].some(
        (submission) => submission && submission.status !== "COMPLETED",
      ));

  React.useEffect(() => {
    if (!supabase || !activeSubmissionId) return;
    const channel = supabase
      .channel(`home-submission-${activeSubmissionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `id=eq.${activeSubmissionId}`,
        },
        async () => {
          const { data } = await supabase
            .from("submissions")
            .select("id, title, artist_name, status, updated_at, payment_status")
            .eq("id", activeSubmissionId)
            .maybeSingle();
          if (!data) return;
          if (tab === "album") {
            setAlbumState((prev) => {
              const submissions = prev.submissions.map((item, idx) =>
                idx === prev.index ? { ...item, ...data } : item,
              );
              return { ...prev, submissions };
            });
          } else {
            setMvState((prev) => {
              const submissions = prev.submissions.map((item, idx) =>
                idx === prev.index ? { ...item, ...data } : item,
              );
              return { ...prev, submissions };
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_reviews",
          filter: `submission_id=eq.${activeSubmissionId}`,
        },
        async () => {
          const { data } = await supabase
            .from("station_reviews")
            .select("id, status, track_results:track_results_json, updated_at, station:stations ( name )")
            .eq("submission_id", activeSubmissionId)
            .order("updated_at", { ascending: false });
          if (!data) return;
          if (tab === "album") {
            setAlbumState((prev) => ({
              ...prev,
              stationsById: {
                ...prev.stationsById,
                [activeSubmissionId]: normalizeStations(data as StationItem[]),
              },
            }));
          } else {
            setMvState((prev) => ({
              ...prev,
              stationsById: {
                ...prev.stationsById,
                [activeSubmissionId]: normalizeStations(data as StationItem[]),
              },
            }));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSubmissionId, normalizeStations, supabase, tab]);

  const totalCount = activeStations.length;
  const completedCount = activeStations.filter((review) =>
    isStationCompleted(review),
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
  const rowHeight = 52;
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
  }, [tab, activeStations.length, activeSubmissionId]);

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
        <span>
          {activeSubmission
            ? `${submissionLabels.summary} 심의`
            : "나의 심의"}
        </span>
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

      <div className="mt-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>
          {activeList.length > 0
            ? `${activeIndex + 1}/${activeList.length}`
            : "0/0"}
          {tab === "album" && activeList.length > 0
            ? ` · 진행중 ${activeList.length}건`
            : null}
          {tab === "mv" && activeList.length > 0
            ? ` · 진행중 ${activeList.length}건`
            : null}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (tab === "album") {
                setAlbumState((prev) => ({
                  ...prev,
                  index: Math.max(0, prev.index - 1),
                }));
              } else {
                setMvState((prev) => ({
                  ...prev,
                  index: Math.max(0, prev.index - 1),
                }));
              }
            }}
            disabled={activeIndex <= 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-white text-xs font-bold text-black shadow-sm transition hover:border-black hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="이전 접수"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              if (tab === "album") {
                setAlbumState((prev) => ({
                  ...prev,
                  index: Math.min(
                    (prev.submissions.length || 1) - 1,
                    prev.index + 1,
                  ),
                }));
              } else {
                setMvState((prev) => ({
                  ...prev,
                  index: Math.min(
                    (prev.submissions.length || 1) - 1,
                    prev.index + 1,
                  ),
                }));
              }
            }}
            disabled={activeIndex >= Math.max(0, activeList.length - 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-white text-xs font-bold text-black shadow-sm transition hover:border-black hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="다음 접수"
          >
            →
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 p-4">
          <p className="sr-only">접수 현황</p>
          {activeSubmission ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">
                  {submissionLabels.summary}
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
            <div className="hidden grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:grid">
              <span>방송국</span>
              <span className="justify-self-center text-center">접수 상태</span>
              <span className="justify-self-center text-center">통과 여부</span>
              <span className="text-right">Updated</span>
            </div>
            {activeStations.length > 0 ? (
              <>
                <div className="hidden text-xs sm:block">
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
                        const result = getResultStatus(station);
                        return (
                          <div
                            key={`${station.id}-${index}`}
                            className="grid min-h-[52px] grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-[11px]"
                          >
                            <span className="flex items-center gap-2 truncate font-semibold text-foreground">
                              <StationLogo station={station.station ?? undefined} hideOnMobile />
                              <span className="truncate">{station.station?.name ?? "-"}</span>
                            </span>
                            <span
                              className={`inline-flex items-center justify-center justify-self-center rounded-full px-2 py-1 text-[10px] font-semibold ${reception.tone}`}
                            >
                              {reception.label}
                            </span>
                            <div className="flex flex-col items-center justify-center gap-1 justify-self-center">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold ${result.tone}`}
                              >
                                {result.label}
                              </span>
                              {result.summaryText ? (
                                <span className="text-[9px] leading-tight text-muted-foreground text-center">
                                  {result.summaryText}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-right text-[10px] text-muted-foreground">
                              {formatDate(station.updated_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 px-3 py-3 sm:hidden">
                  {activeStations.map((station, index) => {
                    const reception = getReceptionStatus(station.status);
                    const result = getResultStatus(station);
                    return (
                      <div
                        key={`${station.id}-mobile-${index}`}
                        className="rounded-xl border border-border/50 bg-background/80 p-3 text-[12px] shadow-sm"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="flex items-center gap-2 truncate font-semibold text-foreground">
                            <StationLogo station={station.station ?? undefined} />
                            <span className="truncate text-sm">{station.station?.name ?? "-"}</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(station.updated_at)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold ${reception.tone}`}
                          >
                            {reception.label}
                          </span>
                          <span
                            className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold ${result.tone}`}
                          >
                            {result.label}
                          </span>
                        </div>
                        {result.summaryText ? (
                          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                            {result.summaryText}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                접수 후 방송국 진행 정보를 확인할 수 있습니다.
              </div>
            )}
          </div>
          {activeSubmission ? (
            <div className="mt-4 flex justify-center">
              <Link
                href={`/dashboard/submissions/${activeSubmission.id}`}
                className="rounded-full border border-border/70 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-black shadow-sm transition hover:border-foreground hover:bg-white/90 dark:text-black"
              >
                자세히 보기
              </Link>
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
}
