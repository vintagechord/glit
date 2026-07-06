"use client";

import Link from "next/link";
import Image from "next/image";
import * as React from "react";
import { ArrowRight, CreditCard } from "lucide-react";
import { normalizeStationReviewStatus } from "@/constants/review-status";
import { formatDate } from "@/lib/format";
import {
  buildStationTrackSummaryText,
  getStationReviewDisplayStatus,
} from "@/lib/station-review-display";
import {
  fallbackStationLogoPath,
  getLocalStationLogoSource,
} from "@/lib/station-logos";
import { summarizeTrackResults } from "@/lib/track-results";
import { createClient } from "@/lib/supabase/client";
import { downloadEndpointFile } from "@/lib/browser-download";

type StationItem = {
  id: string;
  status: string;
  updated_at: string;
  track_results?: unknown;
  result_note?: string | null;
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
  type?: string | null;
  status: string;
  created_at?: string | null;
  updated_at: string;
  payment_status?: string | null;
  result_status?: string | null;
  result_notified_at?: string | null;
  mv_desired_rating?: string | null;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
};

type TabKey = "album" | "mv";

const getSubmissionTimestamp = (submission?: SubmissionSummary | null) => {
  if (!submission) return 0;
  const parsed = Date.parse(submission.created_at ?? submission.updated_at);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getLatestSubmissionTimestamp = (submissions: SubmissionSummary[]) =>
  submissions.reduce(
    (latest, submission) => Math.max(latest, getSubmissionTimestamp(submission)),
    0,
  );

const getPreferredReviewTab = (
  albumSubmissions: SubmissionSummary[],
  mvSubmissions: SubmissionSummary[],
  explicitTab?: TabKey,
): TabKey => {
  if (explicitTab) return explicitTab;
  if (albumSubmissions.length === 0 && mvSubmissions.length > 0) return "mv";
  if (albumSubmissions.length > 0 && mvSubmissions.length > 0) {
    const albumLatest = getLatestSubmissionTimestamp(albumSubmissions);
    const mvLatest = getLatestSubmissionTimestamp(mvSubmissions);
    if (mvLatest > albumLatest) return "mv";
  }
  return "album";
};

type DashboardStatusResponse = {
  albumSubmissions: SubmissionSummary[];
  mvSubmissions: SubmissionSummary[];
  albumStationsMap: Record<string, StationItem[]>;
  mvStationsMap: Record<string, StationItem[]>;
  error?: string;
};

const DASHBOARD_STATUS_FETCH_TIMEOUT_MS = 12_000;

type MvReviewAssetPath = "mv-rating-image" | "mv-guide" | "mv-certificate";

type MvReviewAssetState = {
  submissionId: string;
  ratingCode: string | null;
  ratingLabel: string;
  hasRating: boolean;
  hasResultSignal: boolean;
  hasCertificate: boolean;
  certificateName: string | null;
};

type TrackResultModalState = {
  stationName: string;
  summary: ReturnType<typeof summarizeTrackResults>;
  resultNote: string | null;
  resultLabel: string;
  resultTone: string;
  mvReviewAssets?: MvReviewAssetState;
};

const stageStatusMap = {
  payment: {
    label: "결제 대기",
    tone: "bauhaus-status-chip--neutral",
  },
  pending: {
    label: "결제 대기",
    tone: "bauhaus-status-chip--waiting",
  },
  paid: {
    label: "결제완료",
    tone: "bauhaus-status-chip--success",
  },
  received: {
    label: "접수완료",
    tone: "bauhaus-status-chip--info",
  },
  progress: {
    label: "진행중",
    tone: "bauhaus-status-chip--progress",
  },
  completed: {
    label: "완료",
    tone: "bauhaus-status-chip--success",
  },
  attention: {
    label: "확인 필요",
    tone: "bg-orange-500 text-white dark:bg-orange-300 dark:text-[#06111f]",
  },
};

function shouldOpenResultModal(
  review: StationItem,
  summary: ReturnType<typeof summarizeTrackResults>,
  submission?: SubmissionSummary | null,
) {
  const normalizedStatus = normalizeStationReviewStatus(review.status);
  const mvReviewAssets = buildMvReviewAssetState(submission);
  return (
    Boolean(mvReviewAssets?.hasResultSignal && mvReviewAssets.hasRating) ||
    summary.counts.total > 0 ||
    Boolean(review.result_note?.trim()) ||
    ["APPROVED", "REJECTED", "NEEDS_FIX"].includes(normalizedStatus)
  );
}

function buildResultModalState(
  review: StationItem,
  summary: ReturnType<typeof summarizeTrackResults>,
  result: { label: string; tone: string },
  submission?: SubmissionSummary | null,
): TrackResultModalState {
  const mvReviewAssets = buildMvReviewAssetState(submission);
  const modalMvReviewAssets =
    mvReviewAssets?.hasResultSignal && mvReviewAssets.hasRating
      ? mvReviewAssets
      : null;
  return {
    stationName: review.station?.name ?? "-",
    summary,
    resultNote: review.result_note?.trim() || null,
    resultLabel: result.label,
    resultTone: result.tone,
    ...(modalMvReviewAssets ? { mvReviewAssets: modalMvReviewAssets } : {}),
  };
}

const mvRatingLabel = (code?: string | null) => {
  switch (code) {
    case "ALL":
      return "전체관람가";
    case "12":
      return "12세이상관람가";
    case "15":
      return "15세이상관람가";
    case "18":
      return "청소년관람불가";
    case "19":
      return "청소년관람불가";
    case "REJECT":
      return "심의불가";
    default:
      return "등급 미설정";
  }
};

const hasSubmissionResultSignal = (submission?: SubmissionSummary | null) =>
  Boolean(
    submission?.result_status ||
      submission?.result_notified_at ||
      (submission?.status &&
        ["RESULT_READY", "COMPLETED"].includes(submission.status)),
  );

function buildMvReviewAssetState(
  submission?: SubmissionSummary | null,
): MvReviewAssetState | null {
  if (submission?.type !== "MV_DISTRIBUTION") return null;
  const ratingCode = submission.mv_desired_rating?.trim() || null;
  return {
    submissionId: submission.id,
    ratingCode,
    ratingLabel: mvRatingLabel(ratingCode),
    hasRating: Boolean(ratingCode),
    hasResultSignal: hasSubmissionResultSignal(submission),
    hasCertificate: Boolean(submission.certificate_b2_path?.trim()),
    certificateName: submission.certificate_original_name?.trim() || null,
  };
}

function getDisplayStatusForReview(
  status: ReturnType<typeof getStationReviewDisplayStatus>,
  submission?: SubmissionSummary | null,
) {
  const mvAssets = buildMvReviewAssetState(submission);
  if (!mvAssets?.hasRating || !mvAssets.hasResultSignal) {
    return status;
  }
  return {
    ...status,
    label: mvAssets.ratingCode === "REJECT" ? "부적격" : "적격",
    tone:
      mvAssets.ratingCode === "REJECT"
        ? "bauhaus-status-chip--danger"
        : "bauhaus-status-chip--success",
    summaryText: null,
    isComplete: true,
    needsAttention: mvAssets.ratingCode === "REJECT",
  };
}

function buildMvFallbackStation(submission: SubmissionSummary): StationItem {
  const hasResultSignal = hasSubmissionResultSignal(submission);
  const status = hasResultSignal
    ? submission.mv_desired_rating?.trim() === "REJECT"
      ? "REJECTED"
      : "APPROVED"
    : submission.payment_status === "PAID"
      ? "SENT"
      : "NOT_SENT";
  return {
    id: `fallback-${submission.id}`,
    status,
    updated_at: submission.updated_at,
    track_results: null,
    result_note: null,
    station: {
      id: null,
      name: "영상물등급위원회",
      code: null,
      logo_url: null,
    },
  };
}

const getMvReviewAssetDisabledReason = (
  assets: MvReviewAssetState,
  assetPath: MvReviewAssetPath,
) => {
  if (!assets.hasResultSignal) return "심의 결과 반영 후 다운로드할 수 있습니다.";
  if (!assets.hasRating) return "심의 등급 설정 후 다운로드할 수 있습니다.";
  if (assetPath === "mv-certificate" && !assets.hasCertificate) {
    return "필증 업로드 후 다운로드할 수 있습니다.";
  }
  return null;
};

const getMvReviewDownloadActions = (assets: MvReviewAssetState) => [
  {
    path: "mv-rating-image" as const,
    label: "심의 등급 이미지",
    detail: assets.hasRating ? assets.ratingLabel : "등급 설정 대기",
  },
  {
    path: "mv-certificate" as const,
    label: "필증 다운로드",
    detail: assets.hasCertificate
      ? assets.certificateName ?? "등록 완료"
      : "필증 업로드 대기",
  },
  {
    path: "mv-guide" as const,
    label: "적용 가이드",
    detail: "온라인 심의 공통 파일",
  },
];

const mvReviewFallbackFilenames: Record<MvReviewAssetPath, string> = {
  "mv-rating-image": "onside-mv-rating-image.png",
  "mv-guide": "onside-mv-rating-guide.pdf",
  "mv-certificate": "onside-mv-certificate.pdf",
};

function getStageStatus(submission?: SubmissionSummary | null) {
  if (!submission) return null;
  const status = submission.status;
  if (["RESULT_READY", "COMPLETED"].includes(status)) {
    return stageStatusMap.completed;
  }
  if (status === "IN_PROGRESS") {
    return stageStatusMap.progress;
  }
  if (submission.payment_status === "PAYMENT_PENDING") {
    return stageStatusMap.pending;
  }
  if (submission.payment_status !== "PAID") {
    return stageStatusMap.payment;
  }
  if (["SUBMITTED", "PRE_REVIEW"].includes(status)) {
    return stageStatusMap.received;
  }
  return stageStatusMap.paid;
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

function getStationName(station?: StationItem["station"] | null) {
  return station?.name?.trim() || "-";
}

function getLatestStationUpdatedAt(stations: StationItem[]) {
  let latestValue: string | null = null;
  let latestTimestamp = 0;

  for (const station of stations) {
    const timestamp = Date.parse(station.updated_at);
    if (!Number.isNaN(timestamp) && timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latestValue = station.updated_at;
    }
  }

  return latestValue;
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

function StationLogo({
  station,
  hideOnMobile = false,
  compact = false,
}: {
  station?: { name?: string | null; code?: string | null; logo_url?: string | null } | null;
  hideOnMobile?: boolean;
  compact?: boolean;
}) {
  const key = (station?.name ?? station?.code ?? "").trim().toUpperCase();
  const visibilityClass = hideOnMobile ? "hidden sm:inline-flex" : "inline-flex";
  const logoFrameClass = compact
    ? "h-10 w-[96px]"
    : "h-11 w-[112px] sm:h-12 sm:w-[132px]";
  const mappedLogo = getLocalStationLogoSource(station);

  const initialSrc = mappedLogo?.src ?? station?.logo_url ?? fallbackStationLogoPath;
  const [src, setSrc] = React.useState<string | null>(initialSrc);

  React.useEffect(() => {
    setSrc(initialSrc);
  }, [initialSrc]);

  const handleError = React.useCallback(() => {
    if (src !== fallbackStationLogoPath) {
      setSrc(fallbackStationLogoPath);
      return;
    }
    setSrc(null);
  }, [src]);

  if (src) {
    return (
      <span
        className={`${visibilityClass} ${logoFrameClass} shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-border/60 bg-white p-1.5 shadow-sm`}
      >
        <Image
          src={src}
          alt={station?.name ?? station?.code ?? "station logo"}
          width={132}
          height={48}
          className="h-full w-full object-contain"
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
      className={`${visibilityClass} ${logoFrameClass} shrink-0 items-center justify-center rounded-[8px] border border-border/60 text-xs font-bold uppercase`}
      style={{ color: badge.color, backgroundColor: badge.bg }}
      aria-hidden
    >
      {badge.label.slice(0, 8)}
    </span>
  );
}

export function HomeReviewPanel({
  isLoggedIn,
  viewerId,
  albumSubmissions,
  mvSubmissions,
  albumStationsMap,
  mvStationsMap,
  hideEmptyTabs = false,
  forceLiveBadge = false,
  enableRemoteSync = false,
  stationRowsPerPage = 10,
  showPartialTrackBreakdown = true,
  showDetailLink = true,
  panelMinHeightClassName = "lg:min-h-[520px]",
  compact = false,
  isLoading = false,
  initialTab,
  guestToken,
}: {
  isLoggedIn: boolean;
  viewerId?: string | null;
  albumSubmissions: SubmissionSummary[];
  mvSubmissions: SubmissionSummary[];
  albumStationsMap: Record<string, StationItem[]>;
  mvStationsMap: Record<string, StationItem[]>;
  hideEmptyTabs?: boolean;
  forceLiveBadge?: boolean;
  enableRemoteSync?: boolean;
  stationRowsPerPage?: number;
  showPartialTrackBreakdown?: boolean;
  showDetailLink?: boolean;
  panelMinHeightClassName?: string;
  compact?: boolean;
  isLoading?: boolean;
  initialTab?: TabKey;
  guestToken?: string;
}) {
  const supabase = React.useMemo(
    () => (isLoggedIn ? createClient() : null),
    [isLoggedIn],
  );
  const albumList = albumSubmissions;
  const mvList = mvSubmissions;
  const [tab, setTab] = React.useState<TabKey>(() => {
    return getPreferredReviewTab(albumList, mvList, initialTab);
  });
  const hasManualTabSelection = React.useRef(Boolean(initialTab));
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
  const [remoteStatus, setRemoteStatus] = React.useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [remoteErrorMessage, setRemoteErrorMessage] = React.useState<string | null>(null);
  const [remoteReloadSeq, setRemoteReloadSeq] = React.useState(0);

  const availableTabs = React.useMemo<TabKey[]>(() => {
    if (!hideEmptyTabs) return ["album", "mv"];
    const tabs: TabKey[] = [];
    if (albumState.submissions.length > 0) tabs.push("album");
    if (mvState.submissions.length > 0) tabs.push("mv");
    return tabs.length ? tabs : ["album", "mv"];
  }, [albumState.submissions.length, hideEmptyTabs, mvState.submissions.length]);

  React.useEffect(() => {
    const preferredTab = getPreferredReviewTab(
      albumState.submissions,
      mvState.submissions,
      initialTab,
    );
    setTab((currentTab) => {
      if (!availableTabs.includes(currentTab)) {
        return availableTabs.includes(preferredTab)
          ? preferredTab
          : availableTabs[0] ?? "album";
      }
      if (!hasManualTabSelection.current && currentTab !== preferredTab) {
        return availableTabs.includes(preferredTab) ? preferredTab : currentTab;
      }
      return currentTab;
    });
  }, [albumState.submissions, availableTabs, initialTab, mvState.submissions]);

  const handleTabChange = React.useCallback((nextTab: TabKey) => {
    hasManualTabSelection.current = true;
    setTab(nextTab);
  }, []);

  React.useEffect(() => {
    if (!enableRemoteSync || !isLoggedIn) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, DASHBOARD_STATUS_FETCH_TIMEOUT_MS);
    setRemoteStatus("loading");
    setRemoteErrorMessage(null);
    const fetchRemote = async () => {
      try {
        const res = await fetch("/api/dashboard/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => null)) as DashboardStatusResponse | null;
        if (cancelled) return;
        if (!res.ok || !json || json.error) {
          setRemoteStatus("error");
          setRemoteErrorMessage(
            json?.error || "심의 현황을 불러오지 못했습니다. 다시 시도해주세요.",
          );
          return;
        }
        const normalizeMap = (map: Record<string, StationItem[]>) =>
          Object.fromEntries(
            Object.entries(map ?? {}).map(([key, value]) => [
              key,
              normalizeStations(value),
            ]),
          );
        setAlbumState({
          submissions: json.albumSubmissions ?? [],
          stationsById: normalizeMap(json.albumStationsMap ?? {}),
          index: 0,
        });
        setMvState({
          submissions: json.mvSubmissions ?? [],
          stationsById: normalizeMap(json.mvStationsMap ?? {}),
          index: 0,
        });
        setRemoteStatus("loaded");
      } catch {
        if (!cancelled) {
          setRemoteStatus("error");
          setRemoteErrorMessage(
            controller.signal.aborted
              ? "심의 현황 응답이 지연되고 있습니다. 다시 시도해주세요."
              : "심의 현황을 불러오지 못했습니다. 다시 시도해주세요.",
          );
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    };
    fetchRemote();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [enableRemoteSync, isLoggedIn, normalizeStations, remoteReloadSeq]);

  const activeList = tab === "album" ? albumState.submissions : mvState.submissions;
  const activeIndex = tab === "album" ? albumState.index : mvState.index;
  const activeStationsMap = tab === "album" ? albumState.stationsById : mvState.stationsById;
  const isRemoteLoading = enableRemoteSync && remoteStatus === "loading";
  const isRemoteError = enableRemoteSync && remoteStatus === "error";
  const hasAnySubmission =
    albumState.submissions.length > 0 || mvState.submissions.length > 0;
  const activeSubmission =
    activeList.length > 0 ? activeList[Math.min(activeIndex, activeList.length - 1)] : null;
  const activeSubmissionId = activeSubmission?.id;
  const storedActiveStations = activeSubmissionId
    ? activeStationsMap[activeSubmissionId] ?? []
    : [];
  const activeStations =
    storedActiveStations.length > 0
      ? storedActiveStations
      : activeSubmission?.type === "MV_DISTRIBUTION"
        ? [buildMvFallbackStation(activeSubmission)]
        : storedActiveStations;
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
            .select(
              "id, title, artist_name, status, updated_at, payment_status, type, result_status, result_notified_at, mv_desired_rating, certificate_b2_path, certificate_original_name",
            )
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
            .select(
              "id, status, result_note, track_results:track_results_json, updated_at, station:stations ( id, name, code )",
            )
            .eq("submission_id", activeSubmissionId)
            .order("updated_at", { ascending: false });
          let resolvedData = data;
          if (!resolvedData) {
            const fallback = await supabase
              .from("station_reviews")
              .select(
                "id, status, result_note, track_results, updated_at, station:stations ( id, name, code )",
              )
              .eq("submission_id", activeSubmissionId)
              .order("updated_at", { ascending: false });
            resolvedData = fallback.data ?? resolvedData;
          }
          if (!resolvedData) return;
          if (tab === "album") {
            setAlbumState((prev) => ({
              ...prev,
              stationsById: {
                ...prev.stationsById,
                [activeSubmissionId]: normalizeStations(resolvedData as StationItem[]),
              },
            }));
          } else {
            setMvState((prev) => ({
              ...prev,
              stationsById: {
                ...prev.stationsById,
                [activeSubmissionId]: normalizeStations(resolvedData as StationItem[]),
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

  const needsPayment =
    Boolean(activeSubmission) && activeSubmission?.payment_status !== "PAID";
  const activeSubmissionType =
    activeSubmission?.type ?? (tab === "album" ? "ALBUM" : "MV_DISTRIBUTION");
  const editHref =
    activeSubmissionType === "ALBUM"
      ? "/dashboard/new/album?from=drafts"
      : "/dashboard/new/mv?from=drafts";
  const prepareActiveSubmissionEdit = React.useCallback(() => {
    if (!viewerId || !activeSubmission) return;
    try {
      if (activeSubmissionType === "ALBUM") {
        window.localStorage.setItem(
          `onside:draft:album:${viewerId}`,
          JSON.stringify({
            ids: [activeSubmission.id],
            guestToken: null,
            updatedAt: Date.now(),
          }),
        );
        return;
      }

      window.localStorage.setItem(
        `onside:draft:mv:${viewerId}`,
        JSON.stringify({
          id: activeSubmission.id,
          guestToken: null,
          mvType:
            activeSubmissionType === "MV_BROADCAST"
              ? "MV_BROADCAST"
              : "MV_DISTRIBUTION",
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // Ignore storage failures; the detail/cart paths remain available.
    }
  }, [activeSubmission, activeSubmissionType, viewerId]);
  const totalCount = needsPayment ? 0 : activeStations.length;
  const activeStationDisplayStatuses = activeStations.map((review) =>
    getDisplayStatusForReview(
      getStationReviewDisplayStatus(review, { showPartialTrackBreakdown }),
      activeSubmission,
    ),
  );
  const completedCount = needsPayment
    ? 0
    : activeStationDisplayStatuses.filter((status) => status.isComplete).length;
  const hasAttentionStatus =
    !needsPayment &&
    activeStationDisplayStatuses.some((status) => status.needsAttention);
  const stationProgressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const progressPercent = stationProgressPercent;
  const progressText = `${totalCount}곳 중 ${completedCount}곳 완료 · ${progressPercent}%`;
  const isAlbumStatusContext = tab === "album" || activeSubmission?.type === "ALBUM";
  const hasAllStationResults =
    !needsPayment && totalCount > 0 && completedCount === totalCount;
  const hasPendingAlbumStationResults =
    Boolean(activeSubmission) &&
    isAlbumStatusContext &&
    !needsPayment &&
    totalCount > 0 &&
    !hasAllStationResults;
  const currentSubmissionStatus =
    hasPendingAlbumStationResults
      ? stageStatusMap.received
      : isAlbumStatusContext && hasAllStationResults
        ? stageStatusMap.completed
        : hasAttentionStatus
      ? stageStatusMap.attention
      : activeSubmission && hasAllStationResults
      ? stageStatusMap.completed
      : getStageStatus(activeSubmission);

  const rowsPerPage = Math.max(1, Math.floor(stationRowsPerPage));
  const latestStationUpdatedAt = getLatestStationUpdatedAt(activeStations);
  const stationGridRowsPerPage = Math.max(1, Math.ceil(rowsPerPage / 2));
  const stationCardHeight = compact ? 116 : 86;
  const stationCardGap = compact ? 8 : 10;
  const listPadding = compact ? 8 : 12;
  const listViewportHeight =
    stationGridRowsPerPage * stationCardHeight +
    (stationGridRowsPerPage - 1) * stationCardGap +
    listPadding * 2;
  const shellPaddingClass = compact ? "p-3 sm:p-4" : "p-4 sm:p-6";
  const shellLayoutClass = compact ? "flex h-full flex-col" : "";
  const tabSpacingClass = compact ? "mt-3" : "mt-4 sm:mt-5";
  const pagerSpacingClass = compact ? "mt-2.5" : "mt-3";
  const bodySpacingClass = compact
    ? "mt-4 flex flex-1 flex-col gap-3"
    : "mt-5 space-y-4 sm:mt-6 sm:space-y-5";
  const sectionPaddingClass = compact ? "p-3" : "p-4";
  const stationSectionClass = compact ? "flex flex-1 flex-col" : "";
  const stationTableShellClass = compact
    ? "mt-3 flex flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/70"
    : "mt-3 overflow-hidden rounded-2xl border border-border/60 bg-background/70";
  const stationEmptyClass = compact
    ? "flex flex-1 items-center justify-center px-3 py-5 text-center text-xs text-muted-foreground"
    : "px-3 py-5 text-center text-xs text-muted-foreground";
  const progressBodyClass = compact
    ? "mt-2.5 space-y-2.5"
    : "mt-3 space-y-3";
  const innerCardPaddingClass = compact ? "p-2.5" : "p-3";
  const roundButtonClass = compact
    ? "h-7 w-7 text-[11px]"
    : "h-8 w-8 text-xs";
  const listPaddingClass = compact
    ? "px-2 py-2"
    : "px-2.5 py-2.5 sm:px-3 sm:py-3";
  const stationGridClass = compact
    ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
    : "grid grid-cols-1 gap-2.5 sm:grid-cols-2";
  const stationCardClass = compact
    ? "flex min-h-[116px] flex-col items-center justify-center gap-2 rounded-xl border border-border/50 bg-background/85 px-2.5 py-2 text-xs shadow-sm"
    : "flex min-h-[86px] items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/85 px-3 py-2.5 text-sm shadow-sm";
  const stationStatusActionClass = compact
    ? "min-h-[34px] min-w-[90px] px-2"
    : "min-h-[38px] min-w-[104px] px-3";
  const stationInfoClass = compact
    ? "flex min-w-0 flex-col items-center gap-1 text-center"
    : "flex min-w-0 flex-1 items-center gap-3";
  const stationNameClass = compact
    ? "block max-w-full truncate text-[11px] font-black text-foreground"
    : "block truncate font-black text-foreground";
  const stationListRef = React.useRef<HTMLDivElement | null>(null);
  const mouseDragPointerId = React.useRef<number | null>(null);
  const mouseDragStartY = React.useRef(0);
  const mouseDragStartTop = React.useRef(0);
  const [isMouseDraggingList, setIsMouseDraggingList] = React.useState(false);
  const [canScrollUp, setCanScrollUp] = React.useState(false);
  const [canScrollDown, setCanScrollDown] = React.useState(false);
  const [trackResultModal, setTrackResultModal] =
    React.useState<TrackResultModalState | null>(null);
  const [downloadingMvAsset, setDownloadingMvAsset] =
    React.useState<MvReviewAssetPath | null>(null);

  const openSubmissionDownload = React.useCallback(
    async (submissionId: string, assetPath: MvReviewAssetPath) => {
      const params = new URLSearchParams();
      if (guestToken) params.set("guestToken", guestToken);
      const query = params.toString();
      await downloadEndpointFile(
        `/api/submissions/${submissionId}/${assetPath}${query ? `?${query}` : ""}`,
        mvReviewFallbackFilenames[assetPath],
      );
    },
    [guestToken],
  );

  const handleMvReviewAssetDownload = React.useCallback(
    async (assetPath: MvReviewAssetPath) => {
      const assets = trackResultModal?.mvReviewAssets;
      if (!assets) return;
      const disabledReason = getMvReviewAssetDisabledReason(assets, assetPath);
      if (disabledReason) {
        alert(disabledReason);
        return;
      }
      setDownloadingMvAsset(assetPath);
      try {
        await openSubmissionDownload(assets.submissionId, assetPath);
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : "다운로드 링크를 생성하지 못했습니다.",
        );
      } finally {
        setDownloadingMvAsset(null);
      }
    },
    [openSubmissionDownload, trackResultModal?.mvReviewAssets],
  );
  const updateScrollButtons = React.useCallback(() => {
    const list = stationListRef.current;
    if (!list) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    const maxTop = list.scrollHeight - list.clientHeight;
    if (maxTop <= 1) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    const top = list.scrollTop;
    setCanScrollUp(top > 2);
    setCanScrollDown(maxTop - top > 2);
  }, []);

  React.useEffect(() => {
    const list = stationListRef.current;
    if (!list) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    list.scrollTop = 0;
    setIsMouseDraggingList(false);
    mouseDragPointerId.current = null;
    requestAnimationFrame(() => {
      updateScrollButtons();
    });
  }, [activeSubmissionId, activeStations.length, tab, updateScrollButtons]);

  const handlePrev = React.useCallback(() => {
    const list = stationListRef.current;
    if (!list) return;
    const step = Math.max(
      list.clientHeight - stationCardHeight,
      stationCardHeight * 2,
    );
    list.scrollBy({ top: -step, behavior: "smooth" });
  }, [stationCardHeight]);

  const handleNext = React.useCallback(() => {
    const list = stationListRef.current;
    if (!list) return;
    const step = Math.max(
      list.clientHeight - stationCardHeight,
      stationCardHeight * 2,
    );
    list.scrollBy({ top: step, behavior: "smooth" });
  }, [stationCardHeight]);

  const handleStationListScroll = React.useCallback(() => {
    updateScrollButtons();
  }, [updateScrollButtons]);

  const handleStationListPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") return;
      const list = stationListRef.current;
      if (!list || list.scrollHeight <= list.clientHeight + 1) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, select, textarea")) return;

      mouseDragPointerId.current = event.pointerId;
      mouseDragStartY.current = event.clientY;
      mouseDragStartTop.current = list.scrollTop;
      setIsMouseDraggingList(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );

  const handleStationListPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (mouseDragPointerId.current !== event.pointerId) return;
      const list = stationListRef.current;
      if (!list) return;
      const delta = event.clientY - mouseDragStartY.current;
      list.scrollTop = mouseDragStartTop.current - delta;
    },
    [],
  );

  const endStationListPointerDrag = React.useCallback((pointerId?: number) => {
    if (pointerId != null && mouseDragPointerId.current !== pointerId) return;
    mouseDragPointerId.current = null;
    setIsMouseDraggingList(false);
  }, []);

  const handleStationListPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      endStationListPointerDrag(event.pointerId);
    },
    [endStationListPointerDrag],
  );

  const handleStationListPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      endStationListPointerDrag(event.pointerId);
    },
    [endStationListPointerDrag],
  );

  const modalMvReviewAssets = trackResultModal?.mvReviewAssets ?? null;

  return (
    <div className={`min-w-0 w-full rounded-[10px] border-2 border-[#111111] bg-card ${shellPaddingClass} ${shellLayoutClass} shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] ${panelMinHeightClassName}`}>
      <div className="flex items-center justify-between text-xs font-black uppercase tracking-normal text-foreground/72 sm:text-sm dark:text-white/82">
        <span>
          {isLoading
            ? "심의 현황"
            : isLoggedIn && activeSubmission
            ? `${submissionLabels.summary} 심의`
            : isLoggedIn
              ? "나의 심의"
              : ""}
        </span>
        <span className="inline-flex items-center gap-2">
          {isLoading || isRemoteLoading ? (
            "불러오는 중"
          ) : isRemoteError ? (
            "불러오기 실패"
          ) : isLoggedIn ? (
            <>
              {isLive ? (
                <span className="h-2 w-2 rounded-full bg-rose-500 live-blink" />
              ) : null}
              실시간
            </>
          ) : (
            "진행 현황 예시"
          )}
        </span>
      </div>

      <div className={`${tabSpacingClass} flex items-center gap-2 text-xs font-black uppercase tracking-normal text-muted-foreground sm:text-sm dark:text-white/76`}>
        {availableTabs.includes("album") ? (
          <button
            type="button"
            onClick={() => handleTabChange("album")}
            className={`flex-1 rounded-[8px] border-2 px-3 py-2 transition ${tab === "album"
                ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
                : "border-border bg-background text-foreground/72 hover:border-[#111111] hover:text-foreground dark:text-white/76 dark:hover:border-[#f2cf27] dark:hover:text-white"
              }`}
          >
            앨범
          </button>
        ) : null}
        {availableTabs.includes("mv") ? (
          <button
            type="button"
            onClick={() => handleTabChange("mv")}
            className={`flex-1 rounded-[8px] border-2 px-3 py-2 transition ${tab === "mv"
                ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
                : "border-border bg-background text-foreground/72 hover:border-[#111111] hover:text-foreground dark:text-white/76 dark:hover:border-[#f2cf27] dark:hover:text-white"
              }`}
          >
            뮤직비디오
          </button>
        ) : null}
      </div>

      <div className={`${pagerSpacingClass} flex items-center justify-between text-[11px] font-black uppercase tracking-normal text-foreground/68 sm:text-xs dark:text-white/76`}>
        <span>
          {activeList.length > 0
            ? `${activeIndex + 1}/${activeList.length}`
            : isRemoteLoading
              ? "확인 중"
              : "표시할 내역 없음"}
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#1556a4] bg-[#1556a4] text-xs font-black text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#0f4f99] disabled:cursor-not-allowed disabled:border-border disabled:bg-white disabled:text-muted-foreground disabled:opacity-70 disabled:shadow-none disabled:hover:translate-y-0 dark:border-[#8bc3ff] dark:bg-[#8bc3ff] dark:text-[#06111f] dark:shadow-[3px_3px_0_#1556a4] dark:hover:bg-[#a8d2ff] dark:disabled:border-white/18 dark:disabled:bg-white/8 dark:disabled:text-white/45 dark:disabled:shadow-none sm:h-9 sm:w-9 sm:text-sm"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#1556a4] bg-[#1556a4] text-xs font-black text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#0f4f99] disabled:cursor-not-allowed disabled:border-border disabled:bg-white disabled:text-muted-foreground disabled:opacity-70 disabled:shadow-none disabled:hover:translate-y-0 dark:border-[#8bc3ff] dark:bg-[#8bc3ff] dark:text-[#06111f] dark:shadow-[3px_3px_0_#1556a4] dark:hover:bg-[#a8d2ff] dark:disabled:border-white/18 dark:disabled:bg-white/8 dark:disabled:text-white/45 dark:disabled:shadow-none sm:h-9 sm:w-9 sm:text-sm"
            aria-label="다음 접수"
          >
            →
          </button>
        </div>
      </div>

      <div className={bodySpacingClass}>
        <div className={`rounded-2xl border border-dashed border-border/80 bg-background/70 ${sectionPaddingClass}`}>
          <p className="sr-only">접수 현황</p>
          {activeSubmission ? (
            <div className={progressBodyClass}>
              <div className={`rounded-xl border border-border/60 bg-background/80 ${innerCardPaddingClass}`}>
                <div className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground">
                  <span className="min-w-0 truncate">{progressText}</span>
                  {currentSubmissionStatus ? (
                    <span
                      className={`bauhaus-status-chip bauhaus-status-chip--compact shrink-0 ${currentSubmissionStatus.tone}`}
                    >
                      {currentSubmissionStatus.label}
                    </span>
                  ) : null}
                </div>
                <div
                  className="mt-2 h-2 w-full rounded-full bg-muted"
                  role="progressbar"
                  aria-label="심의 완료율"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                >
                  <div
                    className="h-2 rounded-full bg-primary transition-all dark:bg-[#2997ff]"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {needsPayment && activeSubmission ? (
                  <div className="mt-4 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-3 text-[#111111] shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-normal">
                          결제 대기
                        </p>
                        <p className="mt-1 text-sm font-black sm:text-base">
                          결제가 완료되지 않았습니다.
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#111111]/72">
                          결제 후 심의가 진행됩니다.
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <Link
                          href={editHref}
                          onClick={prepareActiveSubmissionEdit}
                          className="inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-3 text-sm font-black tracking-normal text-[#111111] shadow-[3px_3px_0_rgba(17,17,17,0.34)] transition hover:-translate-y-0.5 hover:bg-[#fff7cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f2cf27] sm:w-auto sm:min-w-[8.5rem]"
                        >
                          수정하기
                        </Link>
                        <Link
                          href={`/mypage/cart?focus=${activeSubmission.id}`}
                          className="inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[var(--bauhaus-red)] px-5 py-3 text-sm font-black tracking-normal text-white shadow-[3px_3px_0_rgba(17,17,17,0.34)] transition hover:-translate-y-0.5 hover:bg-[#b92d25] hover:shadow-[5px_5px_0_rgba(17,17,17,0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f2cf27] dark:text-[#06111f] dark:hover:bg-[#ff7a72] sm:w-auto sm:min-w-[10.5rem]"
                        >
                          <CreditCard aria-hidden="true" className="h-4 w-4" />
                          결제하기
                          <ArrowRight aria-hidden="true" className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-border/60 bg-background/80 px-3 py-3">
              <p className="text-sm font-semibold text-foreground">
                {isLoading || isRemoteLoading
                  ? "심의 현황을 불러오는 중입니다."
                  : isRemoteError
                    ? (remoteErrorMessage ?? "심의 현황을 불러오지 못했습니다.")
                    : hasAnySubmission
                      ? "선택한 유형에 표시할 심의 현황이 없습니다."
                      : "현재 표시할 심의 현황이 없습니다."}
              </p>
              {isRemoteError ? (
                <button
                  type="button"
                  onClick={() => setRemoteReloadSeq((value) => value + 1)}
                  className="mt-3 rounded-[8px] border-2 border-[#111111] bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[2px_2px_0_#f2cf27]"
                >
                  다시 불러오기
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className={`rounded-2xl border border-border/60 bg-background/80 ${sectionPaddingClass} ${stationSectionClass}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                방송국별 현황
              </p>
              {!needsPayment && latestStationUpdatedAt ? (
                <p
                  className="mt-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground"
                  title={formatDate(latestStationUpdatedAt)}
                  aria-label={`Updated ${formatDate(latestStationUpdatedAt)}`}
                >
                  Updated{" "}
                  <span className="text-foreground/72">
                    {formatDate(latestStationUpdatedAt)}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={needsPayment || !canScrollUp}
                className={`inline-flex ${roundButtonClass} items-center justify-center rounded-full border border-primary bg-primary font-bold text-primary-foreground shadow-[0_8px_18px_rgba(0,113,227,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0`}
                aria-label="이전 방송국 상태"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={needsPayment || !canScrollDown}
                className={`inline-flex ${roundButtonClass} items-center justify-center rounded-full border border-primary bg-primary font-bold text-primary-foreground shadow-[0_8px_18px_rgba(0,113,227,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0`}
                aria-label="다음 방송국 상태"
              >
                ↓
              </button>
            </div>
          </div>
          <div className={stationTableShellClass}>
            {!needsPayment && activeStations.length > 0 ? (
              <div
                ref={stationListRef}
                className={`overflow-y-auto overscroll-contain ${listPaddingClass} touch-pan-y ${
                  isMouseDraggingList
                    ? "cursor-grabbing select-none"
                    : "cursor-auto sm:cursor-grab"
                }`}
                style={{ maxHeight: `${listViewportHeight}px` }}
                onScroll={handleStationListScroll}
                onPointerDown={handleStationListPointerDown}
                onPointerMove={handleStationListPointerMove}
                onPointerUp={handleStationListPointerUp}
                onPointerCancel={handleStationListPointerCancel}
                onPointerLeave={handleStationListPointerCancel}
              >
                <div className={stationGridClass}>
                  {activeStations.map((station, index) => {
                    const currentStatus = getStationReviewDisplayStatus(
                      station,
                      { showPartialTrackBreakdown },
                    );
                    const summary = currentStatus.summary;
                    const canOpenResultModal = shouldOpenResultModal(
                      station,
                      summary,
                      activeSubmission,
                    );
                    const displayStatus = getDisplayStatusForReview(
                      currentStatus,
                      activeSubmission,
                    );
                    const stationName = getStationName(station.station);
                    return (
                      <div
                        key={`${station.id}-${index}`}
                        className={stationCardClass}
                      >
                        <div
                          className={stationInfoClass}
                          title={stationName}
                        >
                          <StationLogo
                            station={station.station ?? undefined}
                            compact={compact}
                          />
                          <div className="min-w-0">
                            <span className={stationNameClass}>
                              {stationName}
                            </span>
                            {!canOpenResultModal && displayStatus.summaryText ? (
                              <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                                {displayStatus.summaryText}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {canOpenResultModal ? (
                          <button
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() =>
                              setTrackResultModal(
                                buildResultModalState(
                                  station,
                                  summary,
                                  displayStatus,
                                  activeSubmission,
                                ),
                              )
                            }
                            className={`bauhaus-status-chip bauhaus-status-chip--compact ${stationStatusActionClass} shrink-0 flex-col transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 ${displayStatus.tone}`}
                          >
                            <span>{displayStatus.label}</span>
                            {displayStatus.summaryText ? (
                              <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
                                {displayStatus.summaryText}
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <span
                            className={`bauhaus-status-chip bauhaus-status-chip--compact ${stationStatusActionClass} shrink-0 flex-col ${displayStatus.tone}`}
                          >
                            <span>{displayStatus.label}</span>
                            {displayStatus.summaryText ? (
                              <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
                                {displayStatus.summaryText}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={stationEmptyClass}>
                {isRemoteError
                  ? "심의 현황을 불러오지 못했습니다."
                  : needsPayment
                    ? "입금 확인 후 방송국별 현황이 표시됩니다."
                    : "방송국별 현황이 없습니다."}
              </div>
            )}
          </div>
          {activeSubmission && showDetailLink ? (
            <div className="mt-4 flex justify-center">
              <Link
                href={`/dashboard/submissions/${activeSubmission.id}`}
                className="rounded-full border border-primary bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground shadow-[0_12px_28px_rgba(0,113,227,0.18)] transition hover:bg-[#0077ed] dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]"
              >
                자세히 보기
              </Link>
            </div>
          ) : null}
        </div>

      </div>

      {trackResultModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setTrackResultModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`${trackResultModal.stationName} 심의 결과`}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-4 shadow-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              방송국 결과
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {trackResultModal.stationName}
            </h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`bauhaus-status-chip bauhaus-status-chip--compact ${trackResultModal.resultTone}`}
              >
                {trackResultModal.resultLabel}
              </span>
            </div>
            {trackResultModal.summary.counts.total > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {buildStationTrackSummaryText(trackResultModal.summary.counts, " · ")}
              </p>
            ) : null}
            {trackResultModal.summary.results.length > 0 ? (
              <div className="mt-4 max-h-80 space-y-2 overflow-auto">
              {trackResultModal.summary.results.map((track, index) => {
                const status =
                  track.status === "APPROVED"
                    ? {
                      label: "적격",
                      tone: "bauhaus-status-chip--success",
                    }
                    : track.status === "REJECTED"
                      ? {
                        label: "부적격",
                        tone: "bauhaus-status-chip--danger",
                      }
                      : {
                        label: "대기",
                        tone: "bauhaus-status-chip--neutral",
                      };
                const trackLabel =
                  track.title ||
                  (typeof track.track_no === "number"
                    ? `트랙 ${track.track_no}`
                    : "트랙");
                return (
                  <div
                    key={`${track.track_id ?? index}-${track.track_no ?? index}`}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {track.track_no ? `${track.track_no}. ` : ""}
                        {trackLabel}
                      </p>
                    </div>
                    <span
                      className={`bauhaus-status-chip bauhaus-status-chip--compact ${status.tone}`}
                    >
                      {status.label}
                    </span>
                  </div>
                );
              })}
              </div>
            ) : null}
            {trackResultModal.resultNote ? (
              <div className="mt-4 rounded-xl border border-[#1556a4]/30 bg-[#1556a4]/5 px-3 py-3 dark:border-[#8fb7e8]/40 dark:bg-[#0f1d2e]">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1556a4] dark:text-[#b9d8ff]">
                  {["부적격", "수정요청"].includes(trackResultModal.resultLabel)
                    ? "부적격/수정 사유"
                    : "결과 메모"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80 dark:text-[#d7e7ff]">
                  {trackResultModal.resultNote}
                </p>
              </div>
            ) : null}
            {modalMvReviewAssets
              ? (
                <div className="mt-5 border-t border-border/60 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    뮤직비디오 결과 다운로드
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {getMvReviewDownloadActions(modalMvReviewAssets).map(
                      (action) => {
                        const disabledReason = getMvReviewAssetDisabledReason(
                          modalMvReviewAssets,
                          action.path,
                        );
                        const isDownloading = downloadingMvAsset === action.path;
                        return (
                          <button
                            key={action.path}
                            type="button"
                            onClick={() => handleMvReviewAssetDownload(action.path)}
                            disabled={Boolean(disabledReason) || Boolean(downloadingMvAsset)}
                            className={`min-h-[74px] rounded-[8px] border-2 px-3 py-2 text-left text-xs font-black tracking-normal transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                              disabledReason
                                ? "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground"
                                : "border-[#111111] bg-white text-[#111111] shadow-[3px_3px_0_#111111] hover:-translate-y-0.5 hover:bg-[#f2cf27] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
                            }`}
                          >
                            <span className="block leading-tight">
                              {isDownloading ? "준비 중..." : action.label}
                            </span>
                            <span className="mt-1 block truncate text-[11px] font-semibold leading-tight opacity-75">
                              {disabledReason ?? action.detail}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              )
              : null}
            <button
              type="button"
              onClick={() => setTrackResultModal(null)}
              className="mt-6 w-full rounded-full bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground transition hover:bg-[#0077ed] dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
