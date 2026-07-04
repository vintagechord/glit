"use client";

import Link from "next/link";
import Image from "next/image";
import * as React from "react";
import { normalizeStationReviewStatus } from "@/constants/review-status";
import { formatDate, formatShortDate } from "@/lib/format";
import {
  buildStationTrackSummaryText,
  getStationReviewDisplayStatus,
} from "@/lib/station-review-display";
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
    label: "진행중",
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
) {
  const normalizedStatus = normalizeStationReviewStatus(review.status);
  return (
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
  return {
    stationName: review.station?.name ?? "-",
    summary,
    resultNote: review.result_note?.trim() || null,
    resultLabel: result.label,
    resultTone: result.tone,
    ...(mvReviewAssets ? { mvReviewAssets } : {}),
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
    label: mvAssets.ratingLabel,
    tone:
      mvAssets.ratingCode === "REJECT"
        ? "bauhaus-status-chip--danger"
        : "bauhaus-status-chip--success",
    summaryText: null,
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

function getStationCode(station?: StationItem["station"] | null) {
  const code = station?.code?.trim();
  return code ? code.toUpperCase() : null;
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
          className="h-7 w-auto max-w-7 object-contain"
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
  enableRemoteSync = false,
  stationRowsPerPage = 10,
  showPartialTrackBreakdown = true,
  mobileStationLayout = "cards",
  showDetailLink = true,
  panelMinHeightClassName = "lg:min-h-[520px]",
  compact = false,
  isLoading = false,
  initialTab,
  guestToken,
}: {
  isLoggedIn: boolean;
  albumSubmissions: SubmissionSummary[];
  mvSubmissions: SubmissionSummary[];
  albumStationsMap: Record<string, StationItem[]>;
  mvStationsMap: Record<string, StationItem[]>;
  hideEmptyTabs?: boolean;
  forceLiveBadge?: boolean;
  enableRemoteSync?: boolean;
  stationRowsPerPage?: number;
  showPartialTrackBreakdown?: boolean;
  mobileStationLayout?: "cards" | "table";
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
  const totalCount = needsPayment ? 0 : activeStations.length;
  const activeStationDisplayStatuses = activeStations.map((review) =>
    getStationReviewDisplayStatus(review, { showPartialTrackBreakdown }),
  );
  const completedCount = needsPayment
    ? 0
    : activeStationDisplayStatuses.filter((status) => status.isComplete).length;
  const hasAttentionStatus =
    !needsPayment &&
    activeStationDisplayStatuses.some((status) => status.needsAttention);
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const progressText = `${totalCount}곳 중 ${completedCount}곳 완료 · ${progressPercent}%`;
  const currentSubmissionStatus =
    hasAttentionStatus
      ? stageStatusMap.attention
      : activeSubmission && !needsPayment && totalCount > 0 && completedCount === totalCount
      ? stageStatusMap.completed
      : getStageStatus(activeSubmission);

  const rowsPerPage = Math.max(1, Math.floor(stationRowsPerPage));
  const rowHeight = compact ? 46 : 52;
  const rowGap = compact ? 6 : 8;
  const listPadding = compact ? 8 : 12;
  const listViewportHeight =
    rowsPerPage * rowHeight + (rowsPerPage - 1) * rowGap + listPadding * 2;
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
  const tableHeaderClass = compact
    ? "hidden grid-cols-[minmax(0,1.4fr)_minmax(92px,0.8fr)_80px] items-center gap-2 border-b border-border/60 bg-muted/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground sm:grid"
    : "hidden grid-cols-[minmax(0,1.4fr)_minmax(110px,0.8fr)_96px] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:grid";
  const mobileTableHeaderClass = compact
    ? "grid grid-cols-[minmax(0,1fr)_minmax(96px,auto)_64px] items-center gap-2 border-b border-border/60 bg-muted/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground sm:hidden"
    : "grid grid-cols-[minmax(0,1fr)_minmax(112px,auto)_72px] items-center gap-2 border-b border-border/60 bg-muted/40 px-2 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:hidden";
  const listPaddingClass = compact
    ? "px-2 py-2"
    : "px-2.5 py-2.5 sm:px-3 sm:py-3";
  const desktopStationRowClass = compact
    ? "grid min-h-[46px] grid-cols-[minmax(0,1.4fr)_minmax(92px,0.8fr)_80px] items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-2 py-1.5 text-xs"
    : "grid min-h-[52px] grid-cols-[minmax(0,1.4fr)_minmax(110px,0.8fr)_96px] items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-sm";
  const mobileStationRowClass = compact
    ? "grid min-h-[48px] grid-cols-[minmax(0,1fr)_minmax(96px,auto)_64px] items-center gap-2 px-2 py-1.5 text-xs"
    : "grid min-h-[52px] grid-cols-[minmax(0,1fr)_minmax(112px,auto)_72px] items-center gap-2 px-2 py-2 text-sm";
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
    const step = Math.max(list.clientHeight - rowHeight, rowHeight * 3);
    list.scrollBy({ top: -step, behavior: "smooth" });
  }, [rowHeight]);

  const handleNext = React.useCallback(() => {
    const list = stationListRef.current;
    if (!list) return;
    const step = Math.max(list.clientHeight - rowHeight, rowHeight * 3);
    list.scrollBy({ top: step, behavior: "smooth" });
  }, [rowHeight]);

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
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#111111] bg-white px-3 py-2 text-xs font-semibold text-[#111111] shadow-[3px_3px_0_#111111] dark:border-white dark:bg-[#111111] dark:text-white dark:shadow-[3px_3px_0_rgba(255,255,255,0.55)]">
                    <span>결제 완료 후 심의가 진행됩니다.</span>
                    <Link
                      href={`/dashboard/pay/${activeSubmission.id}`}
                      className="rounded-full border border-[#111111] bg-[#111111] px-3 py-1.5 text-[11px] font-black uppercase tracking-normal text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-[#111111] dark:border-white dark:bg-white dark:text-[#111111] dark:hover:bg-[#111111] dark:hover:text-white"
                    >
                      결제하기
                    </Link>
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
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              방송국별 현황
            </p>
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
            <div className={tableHeaderClass}>
              <span className="pl-2 text-left">방송국</span>
              <span className="justify-self-center text-center">현재 상태</span>
              <span className="text-right">업데이트</span>
            </div>
            {!needsPayment && activeStations.length > 0 ? (
              <>
                {mobileStationLayout === "table" ? (
                  <div className={mobileTableHeaderClass}>
                    <span className="justify-self-center text-center">방송국</span>
                    <span className="justify-self-center text-center">현재 상태</span>
                    <span className="justify-self-center text-center">업데이트</span>
                  </div>
                ) : null}
                <div
                  ref={stationListRef}
                  className={`overflow-y-auto overscroll-contain ${listPaddingClass} touch-pan-y ${isMouseDraggingList
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
                  <div className="hidden text-sm sm:block">
                    <div className="grid gap-2">
                      {activeStations.map((station, index) => {
                        const currentStatus = getStationReviewDisplayStatus(
                          station,
                          { showPartialTrackBreakdown },
                        );
                        const summary = currentStatus.summary;
                        const canOpenResultModal = shouldOpenResultModal(
                          station,
                          summary,
                        );
                        const displayStatus = getDisplayStatusForReview(
                          currentStatus,
                          activeSubmission,
                        );
                        const stationName = getStationName(station.station);
                        const stationCode = getStationCode(station.station);
                        return (
                          <div
                            key={`${station.id}-${index}`}
                            className={desktopStationRowClass}
                          >
                            <span className="flex min-w-0 items-center gap-3 pl-2 text-left">
                              <StationLogo station={station.station ?? undefined} hideOnMobile />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-foreground">
                                  {stationName}
                                </span>
                                {stationCode ? (
                                  <span className="mt-0.5 block truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                                    {stationCode}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <div className="flex flex-col items-center justify-center gap-1 justify-self-center">
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
                                  className={`bauhaus-status-chip bauhaus-status-chip--compact min-h-[38px] min-w-[108px] flex-col px-3 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 ${displayStatus.tone}`}
                                >
                                  <span>{displayStatus.label}</span>
                                  {displayStatus.summaryText ? (
                                    <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
                                      {displayStatus.summaryText}
                                    </span>
                                  ) : null}
                                </button>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <span
                                    className={`bauhaus-status-chip bauhaus-status-chip--compact ${displayStatus.tone}`}
                                  >
                                    {displayStatus.label}
                                  </span>
                                  {displayStatus.summaryText ? (
                                    <span className="text-[11px] leading-tight text-muted-foreground text-center">
                                      {displayStatus.summaryText}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </div>
                            <span
                              className="text-right text-xs text-muted-foreground"
                              title={formatDate(station.updated_at)}
                              aria-label={`업데이트 ${formatDate(station.updated_at)}`}
                            >
                              {formatShortDate(station.updated_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {mobileStationLayout === "table" ? (
                    <div className="divide-y divide-border/50 sm:hidden">
                      {activeStations.map((station, index) => {
                        const currentStatus = getStationReviewDisplayStatus(station);
                        const summary = currentStatus.summary;
                        const canOpenResultModal = shouldOpenResultModal(
                          station,
                          summary,
                        );
                        const displayStatus = getDisplayStatusForReview(
                          currentStatus,
                          activeSubmission,
                        );
                        const stationName = getStationName(station.station);
                        const stationCode = getStationCode(station.station);
                        const stationLabel = stationCode
                          ? `${stationName} (${stationCode})`
                          : stationName;
                        return (
                          <div
                            key={`${station.id}-mobile-${index}`}
                            className={mobileStationRowClass}
                          >
                            <div
                              className="flex min-w-0 items-center justify-start gap-2"
                              title={stationLabel}
                            >
                              <StationLogo station={station.station ?? undefined} />
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-foreground">
                                  {stationName}
                                </span>
                                {stationCode ? (
                                  <span className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
                                    {stationCode}
                                  </span>
                                ) : null}
                              </span>
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
                                className={`bauhaus-status-chip bauhaus-status-chip--compact min-h-[32px] min-w-[100px] justify-self-center transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 ${displayStatus.tone}`}
                              >
                                <span>{displayStatus.label}</span>
                              </button>
                            ) : (
                              <div className="flex items-center justify-self-center">
                                <span
                                  className={`bauhaus-status-chip bauhaus-status-chip--compact ${displayStatus.tone}`}
                                >
                                  {displayStatus.label}
                                </span>
                              </div>
                            )}
                            <span
                              className="justify-self-end text-right text-[11px] text-muted-foreground"
                              title={formatDate(station.updated_at)}
                              aria-label={`업데이트 ${formatDate(station.updated_at)}`}
                            >
                              {formatShortDate(station.updated_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2 sm:hidden">
                      {activeStations.map((station, index) => {
                        const currentStatus = getStationReviewDisplayStatus(
                          station,
                          { showPartialTrackBreakdown },
                        );
                        const summary = currentStatus.summary;
                        const canOpenResultModal = shouldOpenResultModal(
                          station,
                          summary,
                        );
                        const displayStatus = getDisplayStatusForReview(
                          currentStatus,
                          activeSubmission,
                        );
                        const stationName = getStationName(station.station);
                        const stationCode = getStationCode(station.station);
                        return (
                          <div
                            key={`${station.id}-mobile-${index}`}
                            className="rounded-xl border border-border/50 bg-background/80 p-2.5 text-sm shadow-sm"
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-3 pl-1 text-left">
                                <StationLogo station={station.station ?? undefined} />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-foreground">
                                    {stationName}
                                  </span>
                                  {stationCode ? (
                                    <span className="mt-0.5 block truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                                      {stationCode}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              <span
                                className="text-xs text-muted-foreground"
                                title={formatDate(station.updated_at)}
                                aria-label={`업데이트 ${formatDate(station.updated_at)}`}
                              >
                                {formatShortDate(station.updated_at)}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
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
                                  className={`bauhaus-status-chip bauhaus-status-chip--compact min-h-[36px] min-w-[104px] flex-col px-3 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 ${displayStatus.tone}`}
                                >
                                  <span>{displayStatus.label}</span>
                                  {displayStatus.summaryText ? (
                                    <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
                                      {displayStatus.summaryText}
                                    </span>
                                  ) : null}
                                </button>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <span
                                    className={`bauhaus-status-chip bauhaus-status-chip--compact ${displayStatus.tone}`}
                                  >
                                    {displayStatus.label}
                                  </span>
                                  {displayStatus.summaryText ? (
                                    <span className="text-[11px] leading-tight text-muted-foreground text-center">
                                      {displayStatus.summaryText}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
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
          role="dialog"
          aria-modal="true"
          aria-label={`${trackResultModal.stationName} 심의 결과`}
        >
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-4 shadow-xl sm:p-6">
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
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                현재 {trackResultModal.resultLabel} 상태로 등록되어 있습니다.
              </p>
            )}
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
            ) : (
              <div className="mt-4 rounded-xl border border-border/60 bg-background/80 px-3 py-3 text-sm text-muted-foreground">
                트랙별 상세 결과 없이 방송국 결과 상태만 등록되어 있습니다.
              </div>
            )}
            {trackResultModal.resultNote ? (
              <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-3 dark:border-rose-400/40 dark:bg-rose-950/30">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-200">
                  {["부적격", "수정요청"].includes(trackResultModal.resultLabel)
                    ? "부적격/수정 사유"
                    : "결과 메모"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-100">
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
