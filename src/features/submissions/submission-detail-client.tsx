"use client";

import Image from "next/image";
import Link from "next/link";
import * as React from "react";
import {
  paymentStatusLabelMap,
  resultStatusLabelMap,
  reviewStatusLabelMap,
} from "@/constants/review-status";
import {
  SubmissionFilesPanel,
  type SubmissionFile,
} from "@/features/submissions/submission-files-panel";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  summarizeTrackResults,
  type TrackReviewResult,
} from "@/lib/track-results";
import {
  resolveRadioBoardLinks,
  type RadioBoardLink,
} from "@/lib/radio-board-links";
import { createClient } from "@/lib/supabase/client";
import { APP_CONFIG } from "@/lib/config";
import { SUBMISSION_ADMIN_DETAIL_SELECT } from "@/lib/submissions/select-columns";
import {
  RATING_IMAGE_MAP,
  LABEL_GUIDE_KEY,
  isRatingCode,
  type RatingCode,
} from "@/lib/mv-assets";

type Submission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  artist_name_kr?: string | null;
  artist_name_en?: string | null;
  type: string;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  amount_krw: number | null;
  created_at: string;
  updated_at: string;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_mime?: string | null;
  certificate_size?: number | null;
  certificate_uploaded_at?: string | null;
  release_date?: string | null;
  genre?: string | null;
  distributor?: string | null;
  production_company?: string | null;
  previous_release?: string | null;
  artist_type?: string | null;
  artist_gender?: string | null;
  artist_members?: string | null;
  melon_url?: string | null;
  mv_runtime?: string | null;
  mv_format?: string | null;
  mv_director?: string | null;
  mv_lead_actor?: string | null;
  mv_storyline?: string | null;
  mv_production_company?: string | null;
  mv_agency?: string | null;
  mv_album_title?: string | null;
  mv_production_date?: string | null;
  mv_distribution_company?: string | null;
  mv_business_reg_no?: string | null;
  mv_usage?: string | null;
  mv_desired_rating?: string | null;
  mv_memo?: string | null;
  result_status?: string | null;
  result_memo?: string | null;
  mv_song_title?: string | null;
  mv_song_title_kr?: string | null;
  mv_song_title_en?: string | null;
  mv_song_title_official?: string | null;
  mv_composer?: string | null;
  mv_lyricist?: string | null;
  mv_arranger?: string | null;
  mv_song_memo?: string | null;
  mv_lyrics?: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
  package?: {
    name: string | null;
    station_count: number | null;
    price_krw: number | null;
  } | null;
  album_tracks?: Array<{
    id?: string | null;
    track_no?: number | null;
    track_title?: string | null;
    track_title_kr?: string | null;
    track_title_en?: string | null;
    composer?: string | null;
    lyricist?: string | null;
    arranger?: string | null;
    lyrics?: string | null;
    is_title?: boolean | null;
    title_role?: string | null;
    broadcast_selected?: boolean | null;
  }> | null;
};

type SubmissionEvent = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
};

type StationReview = {
  id: string;
  status: string;
  result_note: string | null;
  track_results?: TrackReviewResult[] | null;
  updated_at: string;
  station?: {
    id: string;
    name: string | null;
    code: string | null;
    logo_url?: string | null;
  } | null;
};

const fallbackStationLogo = "/station-logos/default.svg";

const detailPanelClass =
  "rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]";
const detailPanelTightClass =
  "rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]";
const detailSubPanelClass =
  "rounded-[8px] border-2 border-border bg-background";
const detailKickerClass =
  "text-xs font-black uppercase tracking-normal text-muted-foreground";
const detailActionButtonClass =
  "inline-flex items-center justify-center gap-1 rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]";
const detailToggleButtonClass =
  "inline-flex items-center justify-center gap-1 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-white dark:border-[#f2cf27] dark:shadow-[2px_2px_0_#f2cf27]";

const buildTrackSummaryText = (
  counts: { approved: number; rejected: number; pending: number },
  separator: string,
) => {
  const parts = [`${counts.approved}곡 통과`];
  if (counts.rejected > 0) {
    parts.push(`${counts.rejected}곡 불통과`);
  }
  if (counts.pending > 0) {
    parts.push(`${counts.pending}곡 대기`);
  }
  return parts.join(separator);
};

function StationLogoWithFallback({
  station,
}: {
  station?: { id?: string | null; name?: string | null; code?: string | null; logo_url?: string | null } | null;
}) {
  const key = (station?.name ?? station?.code ?? "").trim() || "S";
  const mappedLogo = station?.code ? `/station-logos/${station.code.toLowerCase()}.svg` : null;
  const initialSrc = station?.logo_url ?? mappedLogo;
  const [src, setSrc] = React.useState<string | null>(initialSrc);

  React.useEffect(() => {
    setSrc(initialSrc);
  }, [initialSrc]);

  const handleError = React.useCallback(() => {
    if (src && mappedLogo && src !== mappedLogo) {
      setSrc(mappedLogo);
      return;
    }
    if (src !== fallbackStationLogo) {
      setSrc(fallbackStationLogo);
      return;
    }
    setSrc(null);
  }, [mappedLogo, src]);

  return (
    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[8px] border-2 border-[#111111] bg-white dark:border-[#f2cf27] dark:bg-[#171717]">
      {src ? (
        <Image
          src={src}
          alt={station?.name ?? station?.code ?? "station logo"}
          width={36}
          height={36}
          className="h-full w-full object-cover"
          unoptimized
          onError={handleError}
        />
      ) : (
        <span className="text-sm font-semibold text-foreground">{key.charAt(0)}</span>
      )}
    </div>
  );
}

const paymentMethodLabels: Record<string, string> = {
  BANK: "무통장",
  CARD: "카드",
};

const submissionStatusToneMap: Record<string, string> = {
  DRAFT:
    "border-[#111111] bg-white text-[#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white",
  SUBMITTED:
    "border-[#111111] bg-[#1556a4] text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]",
  PRE_REVIEW:
    "border-[#111111] bg-[#1556a4] text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]",
  WAITING_PAYMENT:
    "border-[#111111] bg-[#f2cf27] text-[#111111] dark:border-[#f2cf27]",
  IN_PROGRESS:
    "border-[#111111] bg-[#1556a4] text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]",
  RESULT_READY:
    "border-[#111111] bg-[#1f7a5a] text-white dark:border-[#f2cf27] dark:bg-[#46b783] dark:text-[#06111f]",
  COMPLETED:
    "border-[#111111] bg-[#1f7a5a] text-white dark:border-[#f2cf27] dark:bg-[#46b783] dark:text-[#06111f]",
};

const paymentStatusToneMap: Record<string, string> = {
  UNPAID:
    "border-[#111111] bg-[#f2cf27] text-[#111111] dark:border-[#f2cf27]",
  PAYMENT_PENDING:
    "border-[#111111] bg-[#1556a4] text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]",
  PAID:
    "border-[#111111] bg-[#1f7a5a] text-white dark:border-[#f2cf27] dark:bg-[#46b783] dark:text-[#06111f]",
  REFUNDED:
    "border-[#111111] bg-[#d9362c] text-white dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111]",
};

const mvRatingLabel = (code?: string | null) => {
  switch (code) {
    case "ALL":
      return "전체관람가";
    case "12":
      return "12세";
    case "15":
      return "15세";
    case "18":
      return "18세(청소년불가)";
    case "19":
      return "19세";
    case "REJECT":
      return "심의불가";
    default:
      return "등급 미설정";
  }
};

const reviewReceptionMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "접수대기",
    tone: "bg-[#f6d64a] text-black dark:text-black",
  },
  SENT: {
    label: "접수완료",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  RECEIVED: {
    label: "심의진행중",
    tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
  },
  APPROVED: {
    label: "결과통보",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "결과통보",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "수정요청",
    tone: "bg-[#f6d64a] text-black dark:text-black",
  },
};

const reviewResultMap: Record<string, { label: string; tone: string }> = {
  APPROVED: {
    label: "통과",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "불통과",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
};

const stationResultFallbackMap: Record<string, { label: string; tone: string }> = {
  APPROVED: {
    label: "결과통보",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "결과통보",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "수정요청",
    tone: "bg-[#f6d64a] text-black dark:text-black",
  },
};

const flowSteps = [
  "접수 완료",
  "결제 확인",
  "심의 진행",
  "결과 전달",
];

const getReviewReception = (status: string) =>
  reviewReceptionMap[status] ?? {
    label: "접수",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  };

const getReviewResult = (status: string) =>
  stationResultFallbackMap[status] ?? {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  };

const getSubmissionTypeLabel = (type: string) => {
  switch (type) {
    case "ALBUM":
      return "음반 심의";
    case "MV_BROADCAST":
      return "M/V 방송 심의";
    case "MV_DISTRIBUTION":
      return "M/V 온라인 심의";
    default:
      return type;
  }
};

export function SubmissionDetailClient({
  submissionId,
  initialSubmission,
  initialFiles,
  initialEvents,
  initialStationReviews,
  enableRealtime = true,
  guestToken,
  paymentState,
}: {
  submissionId: string;
  initialSubmission: Submission;
  initialFiles: SubmissionFile[];
  initialEvents: SubmissionEvent[];
  initialStationReviews: StationReview[];
  enableRealtime?: boolean;
  guestToken?: string;
  paymentState?: string;
}) {
  const supabase = React.useMemo(
    () => (enableRealtime ? createClient() : null),
    [enableRealtime],
  );
  const [submission, setSubmission] =
    React.useState<Submission>(initialSubmission);
  const [events, setEvents] = React.useState<SubmissionEvent[]>(
    initialEvents ?? [],
  );
  const [stationReviews, setStationReviews] = React.useState<StationReview[]>(
    initialStationReviews ?? [],
  );
  const [files, setFiles] = React.useState<SubmissionFile[]>(
    initialFiles ?? [],
  );
  const [isRatingDownloading, setIsRatingDownloading] = React.useState(false);
  const [radioLinksModal, setRadioLinksModal] = React.useState<{
    stationName?: string;
    links: RadioBoardLink[];
  } | null>(null);
  const [trackResultModal, setTrackResultModal] = React.useState<{
    stationName?: string;
    stationCode?: string | null;
    resultNote?: string | null;
    summary: ReturnType<typeof summarizeTrackResults>;
  } | null>(null);
  const [showPaymentInfo, setShowPaymentInfo] = React.useState(false);
  const [isReceptionInfoOpen, setIsReceptionInfoOpen] = React.useState(false);
  const [isSubmissionFormOpen, setIsSubmissionFormOpen] = React.useState(false);
  const [isAttachmentsOpen, setIsAttachmentsOpen] = React.useState(false);
  const showApplicantInfo = Boolean(guestToken);
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvSubmission =
    submission.type === "MV_BROADCAST" || submission.type === "MV_DISTRIBUTION";
  const isResultReady =
    submission.status === "RESULT_READY" || submission.status === "COMPLETED";
  const isPaymentDone =
    submission.payment_status === "PAID" || submission.status === "COMPLETED";
  const isPaymentPending =
    submission.payment_status === "WAITING_PAYMENT" ||
    submission.payment_status === "PAYMENT_PENDING" ||
    (!isPaymentDone &&
      (submission.status === "WAITING_PAYMENT" ||
        submission.status === "PRE_REVIEW"));
  const albumTracks = React.useMemo(
    () => submission.album_tracks ?? [],
    [submission.album_tracks],
  );
  const hasAnyTrackResultDecision = React.useMemo(
    () =>
      stationReviews.some((review) => {
        const summary = summarizeTrackResults(review.track_results, albumTracks);
        return summary.counts.approved > 0 || summary.counts.rejected > 0;
      }),
    [stationReviews, albumTracks],
  );
  const hasResultDeliverySignal =
    submission.status === "RESULT_READY" ||
    submission.status === "COMPLETED" ||
    hasAnyTrackResultDecision;
  const artistTypeLabel =
    submission.artist_type === "GROUP"
      ? "그룹"
      : submission.artist_type === "SOLO"
        ? "솔로"
        : submission.artist_type ?? "-";
  const artistGenderLabel =
    submission.artist_gender === "MALE"
      ? "남"
      : submission.artist_gender === "FEMALE"
        ? "여"
        : submission.artist_gender || "-";
  const flowIndex = (() => {
    if (submission.status === "DRAFT") return 0;
    if (!isPaymentDone) return 0;
    if (hasResultDeliverySignal) return 3;
    if (submission.status === "IN_PROGRESS") return 2;
    return 1;
  })();
  const isReviewComplete =
    isMvSubmission &&
    Boolean(submission.mv_desired_rating) &&
    Boolean(submission.certificate_b2_path) &&
    isResultReady;
  const flowStatusNotice = (() => {
    if (isReviewComplete) {
      return {
        message: "모든 심의 절차가 완료되었습니다.",
        dotTone: "bg-emerald-300",
      };
    }
    if (flowIndex === 3) {
      return {
        message: "심의 결과 통보가 진행 중입니다.",
        dotTone: "bg-[#f6d64a]",
      };
    }
    if (isPaymentDone) {
      return {
        message: "결제가 확인되었고 심의 절차가 진행됩니다.",
        dotTone: "bg-sky-300",
      };
    }
    return {
      message: "현재 결제 대기 상태입니다. 결제 확인 후 심의가 시작됩니다.",
      dotTone: "bg-rose-300",
    };
  })();
  const ratingReason = submission.result_memo?.trim() || null;
  const resultStatusLabel =
    submission.result_status
      ? resultStatusLabelMap[
          submission.result_status as keyof typeof resultStatusLabelMap
        ] ?? submission.result_status
      : "-";


  const stationNames = React.useMemo(() => {
    const names = stationReviews
      .map((review) => review.station?.name?.trim() || "")
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [stationReviews]);

  const mvOptions = React.useMemo(() => {
    if (!isMvSubmission) return null;
    if (submission.type === "MV_DISTRIBUTION") {
      // 온라인 유통 심의 기본 옵션은 영상물등급위원회로 표기
      return ["영상물등급위원회", ...stationNames];
    }
    return stationNames;
  }, [isMvSubmission, stationNames, submission.type]);

  const renderStationReviews =
    stationReviews.length > 0
      ? stationReviews
      : submission.type === "MV_DISTRIBUTION"
        ? [
            {
              id: `fallback-${submission.id}`,
              status: submission.status,
              result_note: null,
              track_results: null,
              updated_at: submission.updated_at,
              station: { name: "영상물등급위원회" },
            },
          ]
        : stationReviews;

  const handleGuideDownload = async () => {
    if (LABEL_GUIDE_KEY.startsWith("http")) {
      window.open(LABEL_GUIDE_KEY, "_blank", "noopener,noreferrer");
      return;
    }
    const params = new URLSearchParams();
    params.set("filePath", LABEL_GUIDE_KEY);
    if (guestToken) params.set("guestToken", guestToken);
    window.open(`/api/b2/download?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const handleCertificateDownload = async () => {
    if (!submission.certificate_b2_path) {
      alert("필증이 아직 업로드되지 않았습니다.");
      return;
    }
    const params = new URLSearchParams();
    params.set("filePath", submission.certificate_b2_path);
    if (guestToken) params.set("guestToken", guestToken);
    window.open(`/api/b2/download?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const buildTrackSummary = React.useCallback(
    (trackResults?: TrackReviewResult[] | null) => {
      const base = summarizeTrackResults(trackResults, albumTracks);
      if (!albumTracks.length) {
        return base;
      }
      const mergedResults = albumTracks.map((track, index) => {
        const matched =
          base.results.find(
            (item) =>
              (item.track_id && track.id && item.track_id === track.id) ||
              (typeof item.track_no === "number" &&
                typeof track.track_no === "number" &&
                item.track_no === track.track_no),
          ) ?? null;
        return {
          track_id: track.id ?? matched?.track_id ?? null,
          track_no: track.track_no ?? matched?.track_no ?? index + 1,
          title:
            track.track_title ||
            track.track_title_kr ||
            track.track_title_en ||
            matched?.title ||
            "트랙",
          status: (matched?.status as string) ?? "PENDING",
        };
      });
      const merged = summarizeTrackResults(mergedResults, albumTracks);
      return { ...merged, results: mergedResults };
    },
    [albumTracks],
  );
  const submissionStatusLabel =
    reviewStatusLabelMap[submission.status as keyof typeof reviewStatusLabelMap] ??
    submission.status;
  const displaySubmissionStatusLabel =
    submission.payment_method === "BANK" && isPaymentPending
      ? "입금 예정"
      : submissionStatusLabel;
  const paymentStatusLabel =
    paymentStatusLabelMap[
      submission.payment_status as keyof typeof paymentStatusLabelMap
    ] ??
    submission.payment_status ??
    "-";
  const mvSongTitleDisplay =
    submission.mv_song_title_official ||
    submission.mv_song_title ||
    submission.mv_song_title_kr ||
    submission.mv_song_title_en ||
    "-";
  const paymentFeedback =
    paymentState === "success"
      ? {
          title: "결제가 완료되었습니다.",
          description: "접수가 정상적으로 반영되었습니다. 아래 상세 화면에서 진행 상황을 확인할 수 있습니다.",
          tone:
            "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-100",
        }
      : paymentState === "cancel"
        ? {
            title: "결제가 취소되었습니다.",
            description:
              "현재 접수 내용은 유지되어 있습니다. 필요하면 다시 결제를 진행하거나 무통장 입금으로 접수할 수 있습니다.",
            tone:
              "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100",
          }
        : paymentState === "fail" || paymentState === "error"
          ? {
              title: "결제가 완료되지 않았습니다.",
              description:
                "결제 과정에서 문제가 발생했습니다. 다시 시도하거나 다른 결제 방식을 선택해주세요.",
              tone:
                "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-300/20 dark:bg-rose-500/10 dark:text-rose-100",
            }
          : null;
  const submissionStatusTone =
    submissionStatusToneMap[submission.status] ??
    "border-[#111111] bg-white text-[#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white";
  const paymentStatusTone =
    paymentStatusToneMap[submission.payment_status] ??
    "border-[#111111] bg-white text-[#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white";
  const submissionTypeLabel = getSubmissionTypeLabel(submission.type);
  const preferredRadioStation = !isMvSubmission
    ? renderStationReviews.find((review) => {
        const summary = buildTrackSummary(review.track_results);
        return summary.counts.approved > 0 || review.status === "APPROVED";
      }) ?? null
    : null;
  const preferredRadioStationCode =
    preferredRadioStation?.station &&
    "code" in preferredRadioStation.station
      ? preferredRadioStation.station.code
      : null;
  const stationSummary = renderStationReviews.reduce(
    (acc, review) => {
      const summary = buildTrackSummary(review.track_results);
      const hasDelivery =
        review.status === "APPROVED" ||
        review.status === "REJECTED" ||
        review.status === "NEEDS_FIX" ||
        summary.counts.approved > 0 ||
        summary.counts.rejected > 0;
      const isProcessing =
        review.status === "SENT" || review.status === "RECEIVED";
      const hasActionNeeded =
        review.status === "NEEDS_FIX" ||
        review.status === "REJECTED" ||
        summary.counts.rejected > 0;
      const hasApproved =
        review.status === "APPROVED" || summary.counts.approved > 0;

      acc.total += 1;
      if (hasDelivery) acc.delivered += 1;
      if (isProcessing) acc.processing += 1;
      if (hasActionNeeded) acc.actionNeeded += 1;
      if (hasApproved) acc.approved += 1;
      return acc;
    },
    { total: 0, delivered: 0, processing: 0, actionNeeded: 0, approved: 0 },
  );
  const summaryCards = [
    {
      label: "접수 상태",
      value: displaySubmissionStatusLabel,
      tone: submissionStatusTone,
      description: flowStatusNotice.message,
    },
    {
      label: "결제 상태",
      value: paymentStatusLabel,
      tone: paymentStatusTone,
      description: submission.payment_method
        ? `${paymentMethodLabels[submission.payment_method] ?? submission.payment_method} 결제`
        : "결제 방식 미입력",
      onClick:
        submission.payment_method === "BANK" && isPaymentPending
          ? () => setShowPaymentInfo(true)
          : undefined,
      actionLabel:
        submission.payment_method === "BANK" && isPaymentPending
          ? "입금 안내 보기"
          : undefined,
    },
    {
      label: "방송국 진행",
      value:
        stationSummary.total > 0
          ? `${stationSummary.delivered}/${stationSummary.total} 결과 반영`
          : "진행 정보 대기",
      tone:
        stationSummary.delivered > 0
          ? "border-[#111111] bg-[#1556a4] text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]"
          : "border-[#111111] bg-white text-[#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white",
      description:
        stationSummary.actionNeeded > 0
          ? `확인 필요 ${stationSummary.actionNeeded}곳`
          : stationSummary.processing > 0
            ? `진행 중 ${stationSummary.processing}곳`
            : "현재 결과 기준",
    },
  ];
  const quickFacts = [
    {
      label: "접수 ID",
      value: submission.id,
    },
    {
      label: isMvSubmission ? "심의 옵션" : "패키지",
      value: isMvSubmission
        ? mvOptions && mvOptions.length > 0
          ? mvOptions.join(", ")
          : "-"
        : packageInfo?.name ?? "-",
    },
    {
      label: "심의 결과",
      value: resultStatusLabel,
    },
    {
      label: isMvSubmission ? "희망 등급" : "트랙 수",
      value: isMvSubmission
        ? submission.mv_desired_rating
          ? mvRatingLabel(submission.mv_desired_rating)
          : "-"
        : `${albumTracks.length}곡`,
    },
    {
      label: "결제 금액",
      value: submission.amount_krw
        ? `${formatCurrency(submission.amount_krw)}원`
        : packageInfo?.price_krw
          ? `${formatCurrency(packageInfo.price_krw)}원`
          : "-",
    },
    {
      label: "접수 일시",
      value: formatDateTime(submission.created_at),
    },
    {
      label: "최근 업데이트",
      value: formatDateTime(submission.updated_at),
    },
  ];
  const renderStationReviewSection = () => (
    <div className={detailPanelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={detailKickerClass}>
          방송국별 진행표
        </p>
        <span className="text-sm text-muted-foreground">
          업데이트: {formatDateTime(submission.updated_at)}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="bauhaus-status-chip bauhaus-status-chip--neutral bauhaus-status-chip--compact">
          전체 {stationSummary.total}곳
        </span>
        <span className="bauhaus-status-chip bauhaus-status-chip--info bauhaus-status-chip--compact">
          결과 반영 {stationSummary.delivered}곳
        </span>
        <span className="bauhaus-status-chip bauhaus-status-chip--success bauhaus-status-chip--compact">
          통과 반영 {stationSummary.approved}곳
        </span>
        <span className="bauhaus-status-chip bauhaus-status-chip--waiting bauhaus-status-chip--compact">
          확인 필요 {stationSummary.actionNeeded}곳
        </span>
      </div>
      <div className="mt-5">
        {renderStationReviews && renderStationReviews.length > 0 ? (
          <div className="rounded-[8px] border-2 border-[#111111] bg-background dark:border-[#f2cf27]">
            <div className="overflow-x-auto">
              <div className="min-w-0 sm:min-w-[720px]">
                <div className="grid grid-cols-[72px_1fr_1fr] items-center gap-3 border-b-2 border-[#111111] bg-[#111111] px-4 py-2 text-xs font-black uppercase tracking-normal text-white dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] sm:grid-cols-[72px_1.1fr_0.95fr_1fr_1fr]">
                  <span className="justify-self-center text-center sm:hidden">방송국</span>
                  <span className="hidden justify-self-center text-center sm:block">로고</span>
                  <span className="hidden text-left sm:block">방송국</span>
                  <span className="justify-self-center text-center">접수 상태</span>
                  <span className="justify-self-center text-center">
                    {isMvSubmission ? "등급 분류" : "트랙 결과"}
                  </span>
                  <span className="hidden justify-self-center text-center sm:block">
                    최근 업데이트
                  </span>
                </div>
                <div className="divide-y divide-border/60">
                  {renderStationReviews.map((review) => {
                    const reception = isReviewComplete
                      ? {
                          label: "결과 통보",
                          tone:
                            "bg-[#1f7a5a] text-white dark:bg-[#46b783] dark:text-[#06111f]",
                        }
                      : getReviewReception(review.status);
                    const trackInfo = buildTrackSummary(review.track_results);
                    const note = review.result_note?.trim() || null;
                    const hasApprovedTrack = trackInfo.counts.approved > 0;
                    const canOpenRadioLinks =
                      hasApprovedTrack || review.status === "APPROVED";
                    const stationCode =
                      review.station && "code" in review.station
                        ? review.station.code
                        : null;
                    const totalTracksForDisplay =
                      albumTracks.length > 1
                        ? albumTracks.length
                        : trackInfo.counts.total;
                    const pendingGap = Math.max(
                      totalTracksForDisplay -
                        (trackInfo.counts.approved +
                          trackInfo.counts.rejected +
                          trackInfo.counts.pending),
                      0,
                    );
                    const pendingCount = trackInfo.counts.pending + pendingGap;
                    const hasTrackDetails = totalTracksForDisplay > 0;
                    const summaryCounts = {
                      approved: trackInfo.counts.approved,
                      rejected: trackInfo.counts.rejected,
                      pending: pendingCount,
                    };
                    const resultTone =
                      isReviewComplete && submission.mv_desired_rating
                        ? {
                            label: mvRatingLabel(submission.mv_desired_rating),
                            tone:
                              "bg-[#1f7a5a] text-white dark:bg-[#46b783] dark:text-[#06111f]",
                          }
                        : trackInfo.outcome === "APPROVED"
                          ? reviewResultMap.APPROVED
                          : trackInfo.outcome === "REJECTED"
                            ? reviewResultMap.REJECTED
                            : trackInfo.outcome === "PARTIAL"
                              ? {
                                  label: "부분 통과",
                                  tone:
                                    "bg-[#f6d64a] text-black dark:text-black",
                                }
                              : hasTrackDetails
                                ? {
                                    label: "대기",
                                    tone:
                                      "bg-slate-500/10 text-slate-500 dark:text-slate-300",
                                  }
                                : getReviewResult(review.status);
                    const trackSummaryLine =
                      totalTracksForDisplay > 1
                        ? buildTrackSummaryText(summaryCounts, " · ")
                        : null;
                    const hasRejectedOutcome =
                      trackInfo.counts.rejected > 0 ||
                      review.status === "REJECTED" ||
                      review.status === "NEEDS_FIX";
                    const resolvedResultNote = hasRejectedOutcome
                      ? note ?? ratingReason ?? null
                      : null;
                    const shouldOpenResultModal =
                      hasTrackDetails || Boolean(resolvedResultNote);

                    const handleResultClick = () => {
                      if (shouldOpenResultModal) {
                        setTrackResultModal({
                          stationName: review.station?.name ?? "-",
                          stationCode,
                          resultNote: resolvedResultNote,
                          summary: trackInfo,
                        });
                        return;
                      }
                      if (canOpenRadioLinks) {
                        openRadioLinks({
                          name: review.station?.name,
                          code: stationCode,
                        });
                      }
                    };

                    return (
                      <div
                        key={review.id}
                        className="grid grid-cols-[72px_1fr_1fr] items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[72px_1.1fr_0.95fr_1fr_1fr]"
                      >
                        <div className="flex items-center justify-center">
                          <StationLogoWithFallback station={review.station} />
                        </div>
                        <div className="hidden min-w-0 pl-1 text-left sm:block">
                          <p className="truncate font-semibold text-foreground">
                            {review.station?.name ?? "-"}
                          </p>
                          {review.station && "code" in review.station ? (
                            <p className="text-xs text-muted-foreground">
                              {review.station.code ?? ""}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`inline-flex items-center justify-center justify-self-center rounded-[6px] border-2 border-[#111111] px-2 py-1 text-xs font-black dark:border-[#f2cf27] ${reception.tone}`}
                        >
                          {reception.label}
                        </span>
                        <button
                          type="button"
                          onClick={handleResultClick}
                          className={`inline-flex min-h-[36px] min-w-[90px] flex-col items-center justify-center justify-self-center rounded-[6px] border-2 border-[#111111] px-2 py-1 text-xs font-black shadow-[2px_2px_0_#111111] dark:border-[#f2cf27] dark:shadow-[2px_2px_0_#f2cf27] ${
                            resultTone.tone
                          } ${
                            shouldOpenResultModal
                              ? "transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
                              : "transition"
                          }`}
                        >
                          <span>{resultTone.label}</span>
                          {trackSummaryLine ? (
                            <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
                              {trackSummaryLine}
                            </span>
                          ) : null}
                        </button>
                        <span className="hidden justify-self-center text-center text-xs text-muted-foreground sm:block">
                          {formatDateTime(review.updated_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[8px] border-2 border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
            아직 방송국 진행 정보가 없습니다. 접수 제출 후 자동 생성됩니다.
          </div>
        )}
      </div>
    </div>
  );

  const openRadioLinks = (station?: { name?: string | null; code?: string | null }) => {
    const links = resolveRadioBoardLinks({
      stationCode: station?.code,
      stationName: station?.name,
    });
    setRadioLinksModal({ stationName: station?.name ?? undefined, links });
  };

  const closeRadioLinks = () => setRadioLinksModal(null);
  const [isTimelineOpen, setIsTimelineOpen] = React.useState(false);

  const fetchLatest = React.useCallback(async () => {
    if (!supabase) return;
    const { data: submissionDataRaw } = await supabase
      .from("submissions")
      .select(SUBMISSION_ADMIN_DETAIL_SELECT)
      .eq("id", submissionId)
      .maybeSingle();

    const submissionData = submissionDataRaw as Submission | null;

    if (submissionData) {
      const nextPackage = Array.isArray(submissionData.package)
        ? submissionData.package[0]
        : submissionData.package;
      const nextTracks = Array.isArray(submissionData.album_tracks)
        ? submissionData.album_tracks
        : [];
      setSubmission({
        ...submissionData,
        package: nextPackage ?? null,
        album_tracks: nextTracks,
      });
    }

    const { data: eventsData } = await supabase
      .from("submission_events")
      .select("id, event_type, message, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false });

    if (eventsData) {
      setEvents(eventsData);
    }

    const stationSelectWithLogo =
      "id, status, result_note, track_results:track_results_json, updated_at, station:stations ( id, name, code, logo_url )";
    const stationSelectWithLogoLegacy =
      "id, status, result_note, track_results, updated_at, station:stations ( id, name, code, logo_url )";
    const stationSelectBasic =
      "id, status, result_note, track_results:track_results_json, updated_at, station:stations ( id, name, code )";
    const stationSelectBasicLegacy =
      "id, status, result_note, track_results, updated_at, station:stations ( id, name, code )";

    const runStationFetch = (select: string) =>
      supabase
        .from("station_reviews")
        .select(select)
        .eq("submission_id", submissionId)
        .order("updated_at", { ascending: false });

    const stationResult = await runStationFetch(stationSelectWithLogo);
    let stationData = stationResult.data ?? null;
    let stationError = stationResult.error ?? null;

    if (stationError) {
      const message = stationError.message?.toLowerCase() ?? "";
      const missingTrackJson = message.includes("track_results_json");
      const missingLogo = message.includes("logo_url");

      if (missingTrackJson) {
        const legacy = await runStationFetch(
          missingLogo ? stationSelectBasicLegacy : stationSelectWithLogoLegacy,
        );
        stationData = legacy.data ?? null;
        stationError = legacy.error ?? null;

        if (stationError && missingLogo) {
          const fallbackLegacy = await runStationFetch(stationSelectBasicLegacy);
          stationData = fallbackLegacy.data ?? null;
          stationError = fallbackLegacy.error ?? null;
        }
      } else if (missingLogo || stationError.code === "42703") {
        const fallback = await runStationFetch(stationSelectBasic);
        stationData = fallback.data ?? null;
        stationError = fallback.error ?? null;
      }
    }

    if (stationData) {
      const normalizedStations = (Array.isArray(stationData) ? stationData : []).map(
        (review) => {
          const base =
            review && typeof review === "object"
              ? (review as {
                  station?: StationReview["station"] | StationReview["station"][];
                  [key: string]: unknown;
                })
              : {};
          const station = Array.isArray(base.station) ? base.station[0] : base.station;
          return { ...base, station };
        },
      );
      setStationReviews(normalizedStations as StationReview[]);
    }

    const { data: fileData } = await supabase
      .from("submission_files")
      .select("id, kind, file_path, original_name, mime, size, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false });

    if (fileData) {
      setFiles(fileData);
    }
  }, [submissionId, supabase]);

  React.useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  React.useEffect(() => {
    if (!enableRealtime || !supabase) return;
    const channel = supabase
      .channel(`submission-${submissionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_reviews",
          filter: `submission_id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submission_events",
          filter: `submission_id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submission_files",
          filter: `submission_id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enableRealtime, fetchLatest, submissionId, supabase]);

  const handleRatingDownload = async () => {
    setIsRatingDownloading(true);
    try {
      const rating = submission.mv_desired_rating;
      const code: RatingCode | null =
        rating && isRatingCode(rating) ? rating : null;
      const path = code ? RATING_IMAGE_MAP[code] : null;
      if (!code || !path) {
        throw new Error("등급이 설정되지 않았습니다.");
      }
      if (path.startsWith("http")) {
        window.open(path, "_blank", "noopener,noreferrer");
      } else {
        const params = new URLSearchParams();
        params.set("filePath", path);
        if (guestToken) params.set("guestToken", guestToken);
        window.open(`/api/b2/download?${params.toString()}`, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "등급 이미지를 불러오지 못했습니다.");
    } finally {
      setIsRatingDownloading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      {paymentFeedback ? (
        <div
          className={`mb-6 rounded-[10px] border-2 px-5 py-4 shadow-[5px_5px_0_#111111] dark:shadow-[5px_5px_0_#f2cf27] ${paymentFeedback.tone}`}
        >
          <p className="text-xs font-black uppercase tracking-normal opacity-80">
            Payment
          </p>
          <h2 className="mt-2 text-lg font-black">{paymentFeedback.title}</h2>
          <p className="mt-1 text-sm opacity-90">{paymentFeedback.description}</p>
        </div>
      ) : null}
      {showPaymentInfo ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <button
            type="button"
            onClick={() => setShowPaymentInfo(false)}
            className="absolute inset-0 bg-black/50"
            aria-label="결제 안내 닫기"
          />
          <div className="relative z-10 w-full max-w-xl rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={detailKickerClass}>
                  결제 안내
                </p>
                <h2 className="mt-2 text-lg font-black text-foreground">
                  {packageInfo?.name ?? submission.title ?? "신청 상품"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  결제 대기 상태입니다. 아래 계좌로 입금 후 알려주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentInfo(false)}
                className={detailToggleButtonClass}
              >
                닫기
              </button>
            </div>
            <div className={`${detailSubPanelClass} mt-4 grid gap-3 p-4 text-sm`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
                  결제 금액
                </span>
                <span className="text-base font-black text-foreground">
                  {submission.amount_krw
                    ? `${formatCurrency(submission.amount_krw)}원`
                    : packageInfo?.price_krw
                      ? `${formatCurrency(packageInfo.price_krw)}원`
                      : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
                  결제 방식
                </span>
                <span className="text-sm text-foreground">
                  {submission.payment_method
                    ? paymentMethodLabels[submission.payment_method] ??
                      submission.payment_method
                    : "무통장"}
                </span>
              </div>
            </div>
            <div className={`${detailSubPanelClass} mt-4 p-4 text-sm`}>
              <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
                무통장 입금 안내
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                    은행
                  </p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                    계좌번호
                  </p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                    예금주
                  </p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankHolder}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                입금 후 문의하기로 알려주시면 확인을 빠르게 도와드립니다.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] px-5 py-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute right-0 top-0 h-6 w-32 bg-[#1556a4] dark:bg-[#3f8ad8]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-4 w-24 bg-[#d9362c] dark:bg-[#ff6258]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-4 w-40 bg-[#f2cf27]" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-3xl flex-1">
            <p className="bauhaus-kicker">
              Submission Detail
            </p>
            <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
              {submission.title || "제목 미입력"}
            </h1>
            <p className="mt-3 text-lg font-semibold text-foreground/82 sm:text-xl">
              {submission.artist_name || "아티스트 미입력"}
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-normal">
              <span className="rounded-[6px] border-2 border-[#111111] bg-[#1556a4] px-3 py-1.5 text-white dark:border-[#f2cf27]">
                {submissionTypeLabel}
              </span>
              {submission.genre ? (
              <span className="rounded-[6px] border-2 border-[#111111] bg-white px-3 py-1.5 text-[#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white">
                  {submission.genre}
                </span>
              ) : null}
              {!isMvSubmission && albumTracks.length > 0 ? (
                <span className="rounded-[6px] border-2 border-[#111111] bg-white px-3 py-1.5 text-[#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white">
                  {albumTracks.length}곡
                </span>
              ) : null}
              <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1.5 text-[#111111] dark:border-[#f2cf27]">
                {guestToken ? "비회원 접수" : "회원 접수"}
              </span>
            </div>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[520px]">
            {summaryCards.map((card) => (
              <button
                key={card.label}
                type="button"
                onClick={card.onClick}
                disabled={!card.onClick}
                className={`rounded-[8px] border-2 px-5 py-4 text-left shadow-[4px_4px_0_#111111] transition dark:shadow-[4px_4px_0_#f2cf27] ${
                  card.onClick
                    ? "cursor-pointer hover:-translate-y-0.5"
                    : "cursor-default"
                } ${card.tone}`}
              >
                <p className="text-[11px] font-black uppercase tracking-normal opacity-75">
                  {card.label}
                </p>
                <p className="mt-3 text-lg font-black tracking-normal">
                  {card.value}
                </p>
                <p className="mt-2 text-xs leading-5 opacity-80">
                  {card.description}
                </p>
                {card.actionLabel ? (
                  <p className="mt-3 text-[11px] font-black uppercase tracking-normal opacity-90">
                    {card.actionLabel}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-8">{renderStationReviewSection()}</div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className={detailPanelClass}>
            <div className="flex items-center justify-between gap-3">
              <p className={detailKickerClass}>
                한눈에 보기
              </p>
              <span className="text-xs text-muted-foreground">
                최근 업데이트 {formatDateTime(submission.updated_at)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {quickFacts.map((item) => (
                <div
                  key={item.label}
                  className={`${detailSubPanelClass} px-4 py-4`}
                >
                  <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-2 break-all text-sm font-semibold text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            {ratingReason ? (
              <div className="mt-4 rounded-[8px] border-2 border-[#d9362c] bg-rose-50 p-4 dark:bg-[#2a1111]">
                <p className="text-[11px] font-black uppercase tracking-normal text-[#d9362c] dark:text-[#ff6258]">
                  결과 메모
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-100">
                  {ratingReason}
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-6 text-white shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-normal text-white/82">
                  진행 단계
                </p>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current/15 bg-white/45 dark:bg-white/10">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${flowStatusNotice.dotTone}`} />
                  </span>
                  <span>{flowStatusNotice.message}</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {flowSteps.map((label, index) => {
                  const isActive = index === flowIndex;
                  const isPassed = index < flowIndex;
                  return (
                    <div
                      key={label}
                      className={`rounded-[8px] border-2 px-3 py-3 text-center text-[11px] font-black leading-5 ${
                        isActive
                          ? "border-[#111111] bg-white text-[#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"
                          : isPassed
                            ? "border-white bg-white/80 text-[#111111] dark:border-white dark:bg-white/14 dark:text-white"
                            : "border-white/80 bg-white/16 text-white"
                      }`}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={detailPanelTightClass}>
              <p className={detailKickerClass}>
                바로 할 수 있는 작업
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {!isMvSubmission && preferredRadioStation ? (
                  <button
                    type="button"
                    onClick={() =>
                      openRadioLinks({
                        name: preferredRadioStation.station?.name,
                        code: preferredRadioStationCode,
                      })
                    }
                    className={detailActionButtonClass}
                  >
                    라디오 신청 링크
                  </button>
                ) : null}
                <Link
                  href="/karaoke-request"
                  className={detailActionButtonClass}
                >
                  노래방 등록
                </Link>
              </div>
            </div>
          </div>
        </div>
      {/* 관리자용 등급/필증 편집 UI는 관리자 페이지에서만 제공 */}
      {/* 사용자 노출 방지를 위해 숨김: 신청 내역 TXT 다운로드 */}

      <div className="mt-8 flex flex-col gap-6">
        <div className="order-2">
          <div className={detailPanelClass}>
            <p className={detailKickerClass}>
              접수 정보
            </p>
            {isReceptionInfoOpen ? (
              <div className="mt-4 grid gap-4 text-base text-foreground md:grid-cols-2">
                {isMvSubmission ? (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">신청 옵션</p>
                      <p className="mt-1 font-semibold">
                        {mvOptions && mvOptions.length > 0
                          ? mvOptions.join(", ")
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">옵션 수</p>
                      <p className="mt-1 font-semibold">
                        {mvOptions && mvOptions.length > 0
                          ? `${mvOptions.length}곳`
                          : "-"}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">패키지</p>
                      <p className="mt-1 font-semibold">
                        {packageInfo?.name ?? "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">방송국 수</p>
                      <p className="mt-1 font-semibold">
                        {packageInfo?.station_count ?? "-"}곳
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">금액</p>
                  <p className="mt-1 font-semibold">
                    {submission.amount_krw
                      ? `${formatCurrency(submission.amount_krw)}원`
                      : packageInfo?.price_krw
                        ? `${formatCurrency(packageInfo.price_krw)}원`
                        : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">결제 상태</p>
                  <p className="mt-1 font-semibold">
                    {submission.payment_status}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">결제 방식</p>
                  <p className="mt-1 font-semibold">
                    {submission.payment_method
                      ? paymentMethodLabels[submission.payment_method] ??
                        submission.payment_method
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">접수 일시</p>
                  <p className="mt-1 font-semibold">
                    {formatDateTime(submission.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">최근 업데이트</p>
                  <p className="mt-1 font-semibold">
                    {formatDateTime(submission.updated_at)}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setIsReceptionInfoOpen((prev) => !prev)}
                aria-label={isReceptionInfoOpen ? "접수 정보 닫기" : "접수 정보 열기"}
                className={detailToggleButtonClass}
              >
                <span>{isReceptionInfoOpen ? "▲" : "▼"}</span>
                <span>{isReceptionInfoOpen ? "접기" : "펼치기"}</span>
              </button>
            </div>
          </div>
        </div>
        <div className="order-1">
          <div className={detailPanelClass}>
            <div className="flex items-center justify-between gap-3">
              <p className={detailKickerClass}>
                진행 현황 요약
              </p>
              <span className="text-xs text-muted-foreground">
                방송국 기준 요약
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={`${detailSubPanelClass} px-4 py-4`}>
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  전체 방송국
                </p>
                <p className="mt-2 text-2xl font-black tracking-normal text-foreground">
                  {stationSummary.total}
                </p>
              </div>
              <div className="rounded-[8px] border-2 border-[#111111] bg-[#1556a4] px-4 py-4 text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]">
                <p className="text-[11px] font-black uppercase tracking-normal opacity-80">
                  결과 반영
                </p>
                <p className="mt-2 text-2xl font-black tracking-normal">
                  {stationSummary.delivered}
                </p>
              </div>
              <div className="rounded-[8px] border-2 border-[#111111] bg-[#1f7a5a] px-4 py-4 text-white dark:border-[#f2cf27] dark:bg-[#46b783] dark:text-[#06111f]">
                <p className="text-[11px] font-black uppercase tracking-normal opacity-80">
                  통과 반영
                </p>
                <p className="mt-2 text-2xl font-black tracking-normal">
                  {stationSummary.approved}
                </p>
              </div>
              <div className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-4 text-[#111111] dark:border-[#f2cf27]">
                <p className="text-[11px] font-black uppercase tracking-normal opacity-80">
                  확인 필요
                </p>
                <p className="mt-2 text-2xl font-black tracking-normal">
                  {stationSummary.actionNeeded}
                </p>
                <p className="mt-2 text-xs opacity-80">
                  진행 중 {stationSummary.processing}곳
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className={`order-4 ${detailPanelClass}`}>
          <p className={detailKickerClass}>
            작성 신청서
          </p>
          {isSubmissionFormOpen ? (
            <>
              <div className="mt-4 grid gap-4 text-base text-foreground md:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {submission.type === "ALBUM" ? "앨범 제목" : "영상 제목"}
                  </p>
                  <p className="mt-1 font-semibold">{submission.title || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">아티스트명</p>
                  <p className="mt-1 font-semibold">
                    {submission.artist_name || "-"}
                    {submission.artist_name_kr ? ` / ${submission.artist_name_kr}` : ""}
                    {submission.artist_name_en ? ` / ${submission.artist_name_en}` : ""}
                  </p>
                </div>
                {showApplicantInfo ? (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">신청자</p>
                      <p className="mt-1 font-semibold">
                        {submission.applicant_name || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">신청자 연락처</p>
                      <p className="mt-1 font-semibold">
                        {submission.applicant_phone || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">신청자 이메일</p>
                      <p className="mt-1 font-semibold">
                        {submission.applicant_email || "-"}
                      </p>
                    </div>
                  </>
                ) : null}
                <div>
                  <p className="text-sm text-muted-foreground">유통사</p>
                  <p className="mt-1 font-semibold">
                    {submission.distributor || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">제작사</p>
                  <p className="mt-1 font-semibold">
                    {submission.production_company || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">발매일</p>
                  <p className="mt-1 font-semibold">
                    {submission.release_date ? formatDateTime(submission.release_date) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">장르</p>
                  <p className="mt-1 font-semibold">
                    {submission.genre || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">이전 발매</p>
                  <p className="mt-1 font-semibold">
                    {submission.previous_release || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">그룹/솔로</p>
                  <p className="mt-1 font-semibold">{artistTypeLabel}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">성별</p>
                  <p className="mt-1 font-semibold">{artistGenderLabel}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">멤버</p>
                  <p className="mt-1 font-semibold">
                    {submission.artist_members || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">멜론 링크</p>
                  <p className="mt-1 font-semibold">
                    {submission.melon_url || "-"}
                  </p>
                </div>
                {isMvSubmission ? (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">러닝타임</p>
                      <p className="mt-1 font-semibold">{submission.mv_runtime || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">포맷</p>
                      <p className="mt-1 font-semibold">{submission.mv_format || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">감독</p>
                      <p className="mt-1 font-semibold">{submission.mv_director || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">주연</p>
                      <p className="mt-1 font-semibold">{submission.mv_lead_actor || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">스토리라인</p>
                      <p className="mt-1 font-semibold">{submission.mv_storyline || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">제작사</p>
                      <p className="mt-1 font-semibold">{submission.mv_production_company || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">에이전시</p>
                      <p className="mt-1 font-semibold">{submission.mv_agency || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">앨범 제목</p>
                      <p className="mt-1 font-semibold">{submission.mv_album_title || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">제작일</p>
                      <p className="mt-1 font-semibold">
                        {submission.mv_production_date ? formatDateTime(submission.mv_production_date) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">배급사</p>
                      <p className="mt-1 font-semibold">{submission.mv_distribution_company || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">사업자등록번호</p>
                      <p className="mt-1 font-semibold">{submission.mv_business_reg_no || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">용도</p>
                      <p className="mt-1 font-semibold">{submission.mv_usage || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">희망 등급</p>
                      <p className="mt-1 font-semibold">{submission.mv_desired_rating || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">곡 제목</p>
                      <p className="mt-1 font-semibold">{mvSongTitleDisplay}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">작곡/작사/편곡</p>
                      <p className="mt-1 font-semibold">
                        {submission.mv_composer || "-"} / {submission.mv_lyricist || "-"} /{" "}
                        {submission.mv_arranger || "-"}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs text-muted-foreground">메모</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                        {submission.mv_memo || "-"}
                      </p>
                    </div>
                    {submission.mv_lyrics ? (
                      <div className="md:col-span-2">
                        <p className="text-xs text-muted-foreground">가사</p>
                        <div className={`${detailSubPanelClass} mt-2 whitespace-pre-wrap p-3 text-sm text-foreground`}>
                          {submission.mv_lyrics}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">아티스트 유형</p>
                      <p className="mt-1 font-semibold">{artistTypeLabel}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">이전 발매</p>
                      <p className="mt-1 font-semibold">
                        {submission.previous_release || "-"}
                      </p>
                    </div>
                  </>
                )}
              </div>
              {!isMvSubmission && albumTracks.length > 0 ? (
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
                    트랙 리스트
                  </p>
                  <div className={`${detailSubPanelClass} p-3 text-sm`}>
                    <div className="divide-y divide-border/60">
                      {albumTracks.map((track, index) => (
                        <div key={`${track.track_no ?? index}-${track.track_title ?? index}`} className="py-2">
                          <p className="font-semibold text-foreground">
                            {track.track_no ?? index + 1}.{" "}
                            {track.track_title || track.track_title_kr || track.track_title_en || "제목 미입력"}
                            {track.is_title ? " · 타이틀" : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            작곡 {track.composer || "-"} / 작사 {track.lyricist || "-"} / 편곡{" "}
                            {track.arranger || "-"}
                          </p>
                          {track.lyrics ? (
                            <details className="mt-1 text-xs text-muted-foreground">
                              <summary className="cursor-pointer">가사 보기</summary>
                              <div className="mt-1 whitespace-pre-wrap text-foreground">
                                {track.lyrics}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setIsSubmissionFormOpen((prev) => !prev)}
                aria-label={isSubmissionFormOpen ? "작성 신청서 닫기" : "작성 신청서 열기"}
                className={detailToggleButtonClass}
              >
              <span>{isSubmissionFormOpen ? "▲" : "▼"}</span>
              <span>{isSubmissionFormOpen ? "접기" : "펼치기"}</span>
            </button>
          </div>
        </div>

        <div className={`order-5 ${detailPanelClass}`}>
          <p className={detailKickerClass}>
            첨부 파일
          </p>
          {isAttachmentsOpen ? (
            <div className="mt-4">
              <SubmissionFilesPanel
                submissionId={submissionId}
                files={files}
                guestToken={guestToken}
                canDownload={false}
              />
            </div>
          ) : null}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setIsAttachmentsOpen((prev) => !prev)}
              aria-label={isAttachmentsOpen ? "첨부 파일 닫기" : "첨부 파일 열기"}
              className={detailToggleButtonClass}
            >
              <span>{isAttachmentsOpen ? "▲" : "▼"}</span>
              <span>{isAttachmentsOpen ? "접기" : "펼치기"}</span>
            </button>
          </div>
        </div>

        {isMvSubmission ? (
          <div className={`order-6 ${detailPanelClass}`}>
            <p className={detailKickerClass}>
              심의 등급 / 가이드 / 필증
            </p>
            <div className="mt-4 space-y-3 text-sm">
              {submission.mv_desired_rating ? (
                <div className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-[13px] font-black text-black dark:border-[#f2cf27]">
                  심의 등급: {mvRatingLabel(submission.mv_desired_rating)} (설정 완료)
                  <span className="ml-2 text-xs font-normal text-black/80">
                    아래에서 등급 이미지와 필증 파일을 다운로드하세요.
                  </span>
                </div>
              ) : (
                <div className="rounded-[8px] border-2 border-dashed border-border bg-background px-4 py-3 text-[13px] text-muted-foreground">
                  심의 등급이 아직 설정되지 않았습니다.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-xs font-black uppercase tracking-normal text-muted-foreground">
                  등급
                </span>
                <button
                  type="button"
                  onClick={handleRatingDownload}
                  disabled={!submission.mv_desired_rating || isRatingDownloading}
                  className={detailActionButtonClass}
                >
                  {submission.mv_desired_rating
                    ? `${mvRatingLabel(submission.mv_desired_rating)} 이미지 다운로드`
                    : "등급 미설정"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-xs font-black uppercase tracking-normal text-muted-foreground">
                  표기 가이드
                </span>
                <button
                  type="button"
                  onClick={handleGuideDownload}
                  className={detailActionButtonClass}
                >
                  가이드 PDF 다운로드
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-xs font-black uppercase tracking-normal text-muted-foreground">
                  심의 필증
                </span>
                <button
                  type="button"
                  onClick={handleCertificateDownload}
                  disabled={!submission.certificate_b2_path}
                  className={detailActionButtonClass}
                >
                  {submission.certificate_original_name
                    ? submission.certificate_original_name
                    : "필증 미등록"}
                </button>
                {!submission.certificate_b2_path ? (
                  <span className="text-xs text-muted-foreground">업로드 완료 후 다운로드 가능</span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="hidden">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              방송국별 진행표
            </p>
            <span className="text-sm text-muted-foreground">
              업데이트: {formatDateTime(submission.updated_at)}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-black/8 bg-white/88 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1d1d1f] dark:border-white/10 dark:bg-white/8 dark:text-white">
              전체 {stationSummary.total}곳
            </span>
            <span className="rounded-full border border-[#cfe3fb] bg-[#eaf3ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#123152] dark:border-[#1d4f7d] dark:bg-[#0b2a46] dark:text-[#8bc3ff]">
              결과 반영 {stationSummary.delivered}곳
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200">
              통과 반영 {stationSummary.approved}곳
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-200">
              확인 필요 {stationSummary.actionNeeded}곳
            </span>
          </div>
          <div className="mt-5">
            {renderStationReviews && renderStationReviews.length > 0 ? (
              <div className="rounded-2xl border border-border/60 bg-background/70">
                <div className="overflow-x-auto">
                  <div className="min-w-0 sm:min-w-[720px]">
                    <div className="grid grid-cols-[72px_1fr_1fr] items-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:grid-cols-[72px_1.1fr_0.95fr_1fr_1fr]">
                      <span className="justify-self-center text-center sm:hidden">방송국</span>
                      <span className="hidden justify-self-center text-center sm:block">로고</span>
                      <span className="hidden text-left sm:block">방송국</span>
                      <span className="justify-self-center text-center">접수 상태</span>
                      <span className="justify-self-center text-center">
                        {isMvSubmission ? "등급 분류" : "트랙 결과"}
                      </span>
                      <span className="hidden justify-self-center text-center sm:block">
                        최근 업데이트
                      </span>
                    </div>
                    <div className="divide-y divide-border/60">
                      {renderStationReviews.map((review) => {
                        const reception = isReviewComplete
                          ? { label: "결과 통보", tone: "bg-emerald-500/15 text-emerald-800" }
                          : getReviewReception(review.status);
                        const trackInfo = buildTrackSummary(review.track_results);
                        const note = review.result_note?.trim() || null;
                        const hasApprovedTrack = trackInfo.counts.approved > 0;
                        const canOpenRadioLinks =
                          hasApprovedTrack || review.status === "APPROVED";
                        const stationCode =
                          review.station && "code" in review.station
                            ? review.station.code
                            : null;
                        const totalTracksForDisplay =
                          albumTracks.length > 1
                            ? albumTracks.length
                            : trackInfo.counts.total;
                        const pendingGap = Math.max(
                          totalTracksForDisplay -
                            (trackInfo.counts.approved +
                              trackInfo.counts.rejected +
                              trackInfo.counts.pending),
                          0,
                        );
                        const pendingCount = trackInfo.counts.pending + pendingGap;
                        const hasTrackDetails = totalTracksForDisplay > 0;
                        const summaryCounts = {
                          approved: trackInfo.counts.approved,
                          rejected: trackInfo.counts.rejected,
                          pending: pendingCount,
                        };
                        const resultTone =
                          isReviewComplete && submission.mv_desired_rating
                            ? {
                                label: mvRatingLabel(submission.mv_desired_rating),
                                tone: "bg-emerald-500/15 text-emerald-800",
                              }
                            : trackInfo.outcome === "APPROVED"
                              ? reviewResultMap.APPROVED
                              : trackInfo.outcome === "REJECTED"
                                ? reviewResultMap.REJECTED
                                : trackInfo.outcome === "PARTIAL"
                                  ? {
                                      label: "부분 통과",
                                      tone:
                                        "bg-[#f6d64a] text-black dark:text-black",
                                    }
                                  : hasTrackDetails
                                    ? {
                                        label: "대기",
                                        tone:
                                          "bg-slate-500/10 text-slate-500 dark:text-slate-300",
                                      }
                                    : getReviewResult(review.status);
                        const trackSummaryLine =
                          totalTracksForDisplay > 1
                            ? buildTrackSummaryText(summaryCounts, " · ")
                            : null;
                        const hasRejectedOutcome =
                          trackInfo.counts.rejected > 0 ||
                          review.status === "REJECTED" ||
                          review.status === "NEEDS_FIX";
                        const resolvedResultNote = hasRejectedOutcome
                          ? note ?? ratingReason ?? null
                          : null;
                        const shouldOpenResultModal =
                          hasTrackDetails || Boolean(resolvedResultNote);

                        const handleResultClick = () => {
                          if (shouldOpenResultModal) {
                            setTrackResultModal({
                              stationName: review.station?.name ?? "-",
                              stationCode,
                              resultNote: resolvedResultNote,
                              summary: trackInfo,
                            });
                            return;
                          }
                          if (canOpenRadioLinks) {
                            openRadioLinks({
                              name: review.station?.name,
                              code: stationCode,
                            });
                          }
                        };

                        return (
                          <div
                            key={review.id}
                            className="grid grid-cols-[72px_1fr_1fr] items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[72px_1.1fr_0.95fr_1fr_1fr]"
                          >
                            <div className="flex items-center justify-center">
                              <StationLogoWithFallback station={review.station} />
                            </div>
                            <div className="hidden min-w-0 pl-1 text-left sm:block">
                              <p className="truncate font-semibold text-foreground">
                                {review.station?.name ?? "-"}
                              </p>
                              {review.station && "code" in review.station ? (
                                <p className="text-xs text-muted-foreground">
                                  {review.station.code ?? ""}
                                </p>
                              ) : null}
                            </div>
                            <span
                              className={`inline-flex items-center justify-center justify-self-center rounded-full px-2 py-1 text-xs font-semibold ${reception.tone}`}
                            >
                              {reception.label}
                            </span>
                            <button
                              type="button"
                              onClick={handleResultClick}
                              className={`inline-flex min-h-[36px] min-w-[90px] flex-col items-center justify-center justify-self-center rounded-full px-2 py-1 text-xs font-semibold ${
                                resultTone.tone
                              } ${
                                shouldOpenResultModal
                                  ? "transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.05] hover:brightness-110 hover:shadow-[0_10px_24px_rgba(15,23,42,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-100"
                                  : "transition"
                              }`}
                            >
                              <span>{resultTone.label}</span>
                              {trackSummaryLine ? (
                                <span className="mt-0.5 text-[11px] font-normal leading-tight text-current/80">
                                  {trackSummaryLine}
                                </span>
                              ) : null}
                            </button>
                            <span className="hidden justify-self-center text-center text-xs text-muted-foreground sm:block">
                              {formatDateTime(review.updated_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
                아직 방송국 진행 정보가 없습니다. 접수 제출 후 자동 생성됩니다.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`mt-8 ${detailPanelClass}`}>
        <div className="flex items-center justify-between">
          <p className={detailKickerClass}>
            타임라인
          </p>
          <button
            type="button"
            onClick={() => setIsTimelineOpen((prev) => !prev)}
            className={detailToggleButtonClass}
          >
            {isTimelineOpen ? "접기" : "펼치기"}
          </button>
        </div>
        {isTimelineOpen ? (
          <div className="mt-4 space-y-3">
            {events && events.length > 0 ? (
              events.map((event) => (
                <div
                  key={event.id}
                  className={`${detailSubPanelClass} px-4 py-3 text-sm`}
                >
                  <div className="flex items-center justify-between text-foreground">
                    <span className="font-semibold">{event.event_type}</span>
                    <span className="text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{event.message}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[8px] border-2 border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
                아직 등록된 이벤트가 없습니다.
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            심의 진행 중 발생한 이벤트를 확인하려면 펼치기를 눌러주세요.
          </p>
        )}
      </div>

      {trackResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-[10px] border-2 border-[#111111] bg-background p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
            <p className={detailKickerClass}>
              트랙별 결과
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {trackResultModal.stationName ?? "-"}
            </h3>
            {trackResultModal.summary.counts.total > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {buildTrackSummaryText(trackResultModal.summary.counts, " · ")}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                방송국 결과가 등록되면 트랙 상세가 표시됩니다.
              </p>
            )}
            {trackResultModal.summary.results.length > 0 ? (
              <div className="mt-4 max-h-80 space-y-2 overflow-auto">
                {trackResultModal.summary.results.map((track, index) => {
                  const status =
                    track.status === "APPROVED"
                      ? { label: "통과", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" }
                      : track.status === "REJECTED"
                        ? { label: "불통과", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200" }
                        : { label: "대기", tone: "bg-slate-500/10 text-slate-600 dark:text-slate-300" };
                  const trackLabel =
                    track.title ||
                    albumTracks.find(
                      (base) =>
                        (track.track_id && base.id === track.track_id) ||
                        (typeof track.track_no === "number" &&
                          base.track_no === track.track_no),
                    )?.track_title ||
                    "트랙";
                  return (
                    <div
                      key={`${track.track_id ?? index}-${track.track_no ?? index}`}
                      className={`${detailSubPanelClass} flex items-center justify-between px-3 py-2 text-sm`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {track.track_no ? `${track.track_no}. ` : ""}
                          {trackLabel}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center justify-center rounded-[6px] border-2 border-[#111111] px-3 py-1 text-xs font-black dark:border-[#f2cf27] ${status.tone}`}
                      >
                        {status.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {trackResultModal.resultNote ? (
              <div className="mt-4 rounded-[8px] border-2 border-[#d9362c] bg-rose-50 p-4 dark:bg-[#2a1111]">
                <p className="text-xs font-black uppercase tracking-normal text-[#d9362c] dark:text-[#ff6258]">
                  불통과 사유
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-100">
                  {trackResultModal.resultNote}
                </p>
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-between gap-3">
              {trackResultModal.summary.counts.approved > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    openRadioLinks({
                      name: trackResultModal.stationName,
                      code: trackResultModal.stationCode ?? null,
                    });
                    setTrackResultModal(null);
                  }}
                  className={detailActionButtonClass}
                >
                  라디오 신청 링크
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setTrackResultModal(null)}
                className={detailActionButtonClass}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {radioLinksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-[10px] border-2 border-[#111111] bg-background p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
            <p className={detailKickerClass}>
              라디오 신청 링크
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {radioLinksModal.stationName
                ? `${radioLinksModal.stationName} 통과/부분통과 · 라디오 신청곡 올리기`
                : "통과/부분통과 · 라디오 신청곡 올리기"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              방송사별 라디오 신청곡/사연 접수 페이지로 이동합니다.
            </p>
            <ul className="mt-4 space-y-2">
              {radioLinksModal.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`${detailSubPanelClass} flex items-center justify-between px-4 py-3 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-foreground`}
                  >
                    <span>{link.name}</span>
                    <span className="text-sm text-muted-foreground">새 창에서 열기 ↗</span>
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeRadioLinks}
                className={detailActionButtonClass}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
