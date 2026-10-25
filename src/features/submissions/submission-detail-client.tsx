"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import {
  ReviewResultControl,
  approvedReviewResultTone as approvedDetailResultTone,
  rejectedReviewResultTone as rejectedDetailResultTone,
} from "@/components/review-result-control";
import {
  normalizeStationReviewStatus,
  paymentStatusLabelMap,
  resultStatusLabelMap,
  type ResultStatus,
} from "@/constants/review-status";
import {
  SubmissionFilesPanel,
  type SubmissionFile,
} from "@/features/submissions/submission-files-panel";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { getAlbumPackageLabel } from "@/lib/album-package-label";
import { brandStatusTones } from "@/lib/brand-status-tones";
import {
  buildStationTrackSummaryText,
  getStationReviewDisplayStatus,
} from "@/lib/station-review-display";
import {
  fallbackStationLogoPath,
  getLocalStationLogoSource,
} from "@/lib/station-logos";
import {
  summarizeTrackResults,
  resolveStationTrackResults,
  type TrackReviewResult,
} from "@/lib/track-results";
import { createClient } from "@/lib/supabase/client";
import { BroadcastSupportPanel } from "@/features/submissions/broadcast-support-panel";
import { RadioRequestDialog } from "@/features/submissions/radio-request-dialog";
import { RadioStationGuideContent } from "@/features/submissions/radio-station-guide";
import { APP_CONFIG } from "@/lib/config";
import { SubmissionSupplements } from "@/features/submissions/submission-supplements";
import { SUBMISSION_USER_DETAIL_SELECT } from "@/lib/submissions/select-columns";
import { loadSubmissionDetailRelations, preservePendingStationReviews } from "@/lib/submissions/detail-relations";
import { customerPaymentFeedback } from "@/lib/customer-payment-feedback";
import { downloadEndpointFile } from "@/lib/browser-download";
import { addGuestSubmissionCartEntries, readGuestSubmissionOrderEntries, rememberGuestSubmissionOrderEntries } from "@/lib/guest-submission-cart";
import { buildSubmissionCheckoutHref, prepareOrderCheckout } from "@/lib/submission-checkout";
import { getPaidReviewProgress } from "@/lib/paid-review-progress";

type Submission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  artist_name_kr?: string | null;
  artist_name_en?: string | null;
  type: string;
  is_oneclick?: boolean | null;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  current_order_id?: string | null;
  amount_krw: number | null;
  ai_used?: boolean | null;
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
    performer?: string | null;
    composer?: string | null;
    lyricist?: string | null;
    arranger?: string | null;
    lyrics?: string | null;
    is_title?: boolean | null;
    title_role?: string | null;
    broadcast_selected?: boolean | null;
  }> | null;
  result_notified_at?: string | null;
};

type StationReview = {
  id: string;
  status: string;
  result_note: string | null;
  age_rating?: string | null;
  track_results?: TrackReviewResult[] | null;
  updated_at: string;
  station?: {
    id: string;
    name: string | null;
    code: string | null;
    logo_url?: string | null;
  } | null;
};

const detailPanelClass =
  "min-w-0 rounded-[10px] border-2 border-[#111111] bg-card p-4 shadow-[6px_6px_0_#111111] sm:p-6 dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]";
const detailSubPanelClass =
  "rounded-[8px] border-2 border-border bg-background";
const detailKickerClass =
  "text-xs font-black uppercase tracking-normal text-muted-foreground";
const detailActionButtonClass =
  "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-1 rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-center text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]";
const detailToggleButtonClass =
  "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-1 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-center text-xs font-black uppercase tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-white dark:border-[#f2cf27] dark:shadow-[2px_2px_0_#f2cf27]";

const buildTrackSummaryText = (
  counts: { approved: number; rejected: number; pending: number },
  separator: string,
) => {
  return buildStationTrackSummaryText(counts, separator);
};

function StationLogoWithFallback({
  station,
}: {
  station?: { id?: string | null; name?: string | null; code?: string | null; logo_url?: string | null } | null;
}) {
  const stationName = station?.name?.trim() || station?.code?.trim() || "방송국";
  const mappedLogo = getLocalStationLogoSource(station);
  const logoSrc = mappedLogo?.src ?? station?.logo_url?.trim();
  const initialSrc = logoSrc && logoSrc !== fallbackStationLogoPath ? logoSrc : null;
  const [src, setSrc] = React.useState<string | null>(initialSrc);

  React.useEffect(() => {
    setSrc(initialSrc);
  }, [initialSrc]);

  return (
    <div className="flex min-h-[52px] w-[104px] max-w-full shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white p-1.5 sm:w-[136px] dark:border-[#f2cf27]" title={stationName}>
      {src ? (
        <Image
          src={src}
          alt={stationName}
          width={136}
          height={52}
          className="h-[36px] w-full object-contain"
          unoptimized
          loading="lazy"
          onError={() => setSrc(null)}
        />
      ) : (
        <span className="break-words text-center text-xs font-semibold text-[#111111]">
          {stationName}
        </span>
      )}
    </div>
  );
}

const paymentMethodLabels: Record<string, string> = {
  BANK: "무통장",
  CARD: "카드",
};

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

const aiUsageLabel = (value?: boolean | null) => {
  if (value === true) return "AI 활용함";
  if (value === false) return "AI 사용 안 함";
  return "미입력";
};

type DetailPrimaryAction = "payment-info" | "retry-payment" | "order-status" | "station-review" | null;

const normalizePaymentStatusLabel = (
  paymentStatus?: string | null,
  isPaymentDone?: boolean,
  isPaymentPending?: boolean,
  paymentMethod?: string | null,
) => {
  if (isPaymentDone || paymentStatus === "PAID") return "결제 완료";
  if (paymentStatus === "REFUNDED") return "환불";
  if (paymentStatus === "UNPAID") return "미결제";
  if (isPaymentPending || paymentStatus === "PAYMENT_PENDING" || paymentStatus === "WAITING_PAYMENT") {
    return paymentMethod === "BANK" ? "입금 확인 대기" : "결제 확인 대기";
  }
  return paymentStatus
    ? paymentStatusLabelMap[paymentStatus as keyof typeof paymentStatusLabelMap] ??
        paymentStatus
    : "-";
};

const buildSubmissionDisplayStatus = ({
  submissionStatus,
  paymentStatus,
  paymentMethod,
  isPaymentDone,
  isPaymentPending,
  stationTotal,
  stationSubmitted,
  stationDelivered,
  isMvSubmission,
  resultDelivered,
}: {
  submissionStatus: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  isPaymentDone: boolean;
  isPaymentPending: boolean;
  stationTotal: number;
  stationSubmitted: number;
  stationDelivered: number;
  isMvSubmission: boolean;
  resultDelivered: boolean;
}) => {
  const isDraft = submissionStatus === "DRAFT";
  const safeStationTotal = Math.max(stationTotal, 0);
  const hasAllStationResults =
    safeStationTotal > 0 && stationDelivered >= safeStationTotal;
  const submissionLabel = isDraft ? "임시 저장" : "신청서 제출 완료";
  const paymentLabel = normalizePaymentStatusLabel(
    paymentStatus,
    isPaymentDone,
    isPaymentPending,
    paymentMethod,
  );
  const broadcastLabel = isPaymentDone
    ? safeStationTotal > 0
      ? `${Math.min(stationSubmitted, safeStationTotal)}/${safeStationTotal} 접수`
      : "접수 준비"
    : "접수 대기";
  const resultLabel =
    safeStationTotal > 0
      ? `${Math.min(stationDelivered, safeStationTotal)}/${safeStationTotal} 결과 반영`
      : "0/0 결과 반영";

  if (isDraft) {
    return {
      currentLabel: "신청서 작성 중",
      submissionLabel,
      paymentLabel,
      broadcastLabel,
      resultLabel,
      primaryMessage: "신청서 작성이 아직 완료되지 않았습니다.",
      secondaryMessage: "작성 내용을 확인한 뒤 제출을 완료해주세요.",
      primaryAction: null as DetailPrimaryAction,
      primaryActionLabel: null,
    };
  }

  if (paymentStatus === "REFUNDED") {
    return {
      currentLabel: "환불",
      submissionLabel,
      paymentLabel,
      broadcastLabel,
      resultLabel,
      primaryMessage: "결제가 환불되었습니다.",
      secondaryMessage: "환불된 신청의 내역을 확인할 수 있습니다.",
      primaryAction: null as DetailPrimaryAction,
      primaryActionLabel: null,
    };
  }

  if (!isPaymentDone && paymentMethod && paymentMethod !== "BANK" && ["PAYMENT_PENDING", "WAITING_PAYMENT"].includes(paymentStatus ?? "")) {
    return {
      currentLabel: "결제 확인 대기", submissionLabel, paymentLabel, broadcastLabel, resultLabel,
      primaryMessage: "결제 승인 상태를 확인 중입니다.",
      secondaryMessage: "이미 결제를 진행했다면 주문내역에서 승인 상태를 확인해주세요.",
      primaryAction: "order-status" as DetailPrimaryAction,
      primaryActionLabel: "주문내역 확인",
    };
  }

  if (!isPaymentDone) {
    return {
      currentLabel: paymentLabel,
      submissionLabel,
      paymentLabel,
      broadcastLabel,
      resultLabel,
      primaryMessage: "결제 확인 후 심의 접수가 이어집니다.",
      secondaryMessage: "현재 입금 확인 전 단계입니다.",
      primaryAction:
        paymentMethod && paymentMethod !== "BANK"
          ? ("retry-payment" as DetailPrimaryAction)
          : ("payment-info" as DetailPrimaryAction),
      primaryActionLabel:
        paymentMethod && paymentMethod !== "BANK" ? "결제하기" : "입금 안내 보기",
    };
  }

  if (resultDelivered || hasAllStationResults) {
    return {
      currentLabel: isMvSubmission ? "심의 결과 통보 완료" : "결과 통보 완료",
      submissionLabel,
      paymentLabel,
      broadcastLabel,
      resultLabel,
      primaryMessage: isMvSubmission ? "심의 결과 확인이 가능합니다." : null,
      secondaryMessage: isMvSubmission
        ? "방송국별 현황 표에서 적격/부적격 결과와 다운로드 자료를 확인할 수 있습니다."
        : "방송국별 진행표에서 결과와 Updated 시간을 확인할 수 있습니다.",
      primaryAction: "station-review" as DetailPrimaryAction,
      primaryActionLabel: isMvSubmission ? "현황 보기" : "진행표 보기",
    };
  }

  if (stationDelivered > 0) {
    return {
      currentLabel: "결과 반영 중",
      submissionLabel,
      paymentLabel,
      broadcastLabel,
      resultLabel,
      primaryMessage: isMvSubmission
        ? "도착한 결과가 순차적으로 반영되고 있습니다."
        : "방송국별 결과가 순차적으로 반영되고 있습니다.",
      secondaryMessage: isMvSubmission
        ? "결과가 확정되면 방송국별 현황 표에 업데이트됩니다."
        : "모든 방송국의 결과가 반영되면 완료로 표시됩니다.",
      primaryAction: "station-review" as DetailPrimaryAction,
      primaryActionLabel: isMvSubmission ? "현황 보기" : "진행표 보기",
    };
  }

  if (isPaymentDone) {
    const progress = getPaidReviewProgress({
      status: submissionStatus,
      stationTotal: safeStationTotal,
      stationSubmitted,
      stationCompleted: stationDelivered,
      resultDelivered,
    });
    return {
      currentLabel: progress === "WAITING_SUBMISSION" ? "접수예정" : "심의 진행 중",
      submissionLabel,
      paymentLabel,
      broadcastLabel,
      resultLabel,
      primaryMessage: stationSubmitted > 0
        ? "심의 진행 상황을 확인할 수 있습니다."
        : "결제가 확인되었고 접수 정보를 준비 중입니다.",
      secondaryMessage:
        isMvSubmission
          ? "담당자 확인 후 방송국별 현황 표에 상태가 반영됩니다."
          : safeStationTotal > 0
          ? "방송사별 접수 상태가 진행표에 순차 반영됩니다."
          : "관리자 확인 후 방송사 접수 정보가 생성됩니다.",
      primaryAction: "station-review" as DetailPrimaryAction,
      primaryActionLabel: isMvSubmission ? "현황 보기" : "진행표 보기",
    };
  }

  return {
    currentLabel: "접수 상태 확인 중",
    submissionLabel,
    paymentLabel,
    broadcastLabel,
    resultLabel,
    primaryMessage: "접수 상태를 확인하고 있습니다.",
    secondaryMessage: "상세 진행 상황은 아래 진행표에서 확인할 수 있습니다.",
    primaryAction: null as DetailPrimaryAction,
    primaryActionLabel: null,
  };
};

type MvReviewAssetPath = "mv-rating-image" | "mv-guide" | "mv-certificate";

type DetailMvReviewAssetState = {
  ratingLabel: string;
  hasCertificate: boolean;
  certificateName: string | null;
};

const mvReviewFallbackFilenames: Record<MvReviewAssetPath, string> = {
  "mv-rating-image": "onside-mv-rating-image.png",
  "mv-guide": "onside-mv-rating-guide.pdf",
  "mv-certificate": "onside-mv-certificate.pdf",
};

export function SubmissionDetailClient({
  submissionId,
  initialSubmission,
  initialFiles,
  initialStationReviews,
  enableRealtime = true,
  initialDataComplete = false,
  guestToken,
  paymentState,
  refreshIntervalMs,
  resultsOnly = false,
}: {
  submissionId: string;
  initialSubmission: Submission;
  initialFiles: SubmissionFile[];
  initialStationReviews: StationReview[];
  enableRealtime?: boolean;
  initialDataComplete?: boolean;
  guestToken?: string;
  paymentState?: string;
  refreshIntervalMs?: number;
  resultsOnly?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const supabase = React.useMemo(
    () => (enableRealtime ? createClient() : null),
    [enableRealtime],
  );
  const [submission, setSubmission] =
    React.useState<Submission>(initialSubmission);
  const [stationReviews, setStationReviews] = React.useState<StationReview[]>(
    initialStationReviews ?? [],
  );
  const [files, setFiles] = React.useState<SubmissionFile[]>(
    initialFiles ?? [],
  );
  const latestRefresh = React.useRef(0);
  const [isRatingDownloading, setIsRatingDownloading] = React.useState(false);
  const radioReturnFocusRef = React.useRef<HTMLButtonElement | null>(null);
  const [radioLinksModal, setRadioLinksModal] = React.useState<{ reviewId: string; open: boolean } | null>(null);
  const [trackResultModal, setTrackResultModal] = React.useState<{
    reviewId: string;
    stationName?: string;
    stationCode?: string | null;
    resultNote?: string | null;
    resultLabel?: string;
    resultTone?: string;
    canRequestRadio?: boolean;
    mvReviewAssets?: DetailMvReviewAssetState;
    summary: ReturnType<typeof summarizeTrackResults>;
  } | null>(null);
  const [showPaymentInfo, setShowPaymentInfo] = React.useState(false);
  const [isPreparingCheckout, setIsPreparingCheckout] = React.useState(false);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const checkoutPendingRef = React.useRef(false);
  const [isReceptionInfoOpen, setIsReceptionInfoOpen] = React.useState(false);
  const [isSubmissionFormOpen, setIsSubmissionFormOpen] = React.useState(false);
  const [isAttachmentsOpen, setIsAttachmentsOpen] = React.useState(false);
  const showApplicantInfo = Boolean(guestToken);
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvDistribution = submission.type === "MV_DISTRIBUTION";
  const isMvBroadcast = submission.type === "MV_BROADCAST";
  const isMvSubmission = isMvDistribution || isMvBroadcast;
  const isResultReady =
    submission.status === "RESULT_READY" || submission.status === "COMPLETED";
  const hasResultSignal = Boolean(
    isResultReady || submission.result_status || submission.result_notified_at,
  );
  const isPaymentDone = submission.payment_status === "PAID";
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
  const hasMvRatingResult =
    isMvDistribution && Boolean(submission.mv_desired_rating) && hasResultSignal;
  const hasMvDistributionResult = isMvDistribution && hasResultSignal;
  const isReviewComplete =
    hasMvDistributionResult ||
    (isMvBroadcast && isResultReady);
  const canDownloadMvReviewAssets = hasMvRatingResult;
  const mvFallbackStationStatus =
    canDownloadMvReviewAssets && submission.mv_desired_rating
      ? submission.mv_desired_rating === "REJECT"
        ? "REJECTED"
        : "APPROVED"
      : isPaymentDone && ["IN_PROGRESS", "RESULT_READY", "COMPLETED"].includes(submission.status)
        ? "SENT"
        : "NOT_SENT";

  const stationNames = React.useMemo(() => {
    const names = stationReviews
      .map((review) => review.station?.name?.trim() || "")
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [stationReviews]);

  const mvOptions = React.useMemo(() => {
    if (!isMvSubmission) return null;
    if (isMvDistribution) {
      // 온라인 유통 심의 기본 옵션은 영상물등급위원회로 표기
      return Array.from(new Set(["영상물등급위원회", ...stationNames]));
    }
    return stationNames;
  }, [isMvDistribution, isMvSubmission, stationNames]);

  const renderStationReviews =
    stationReviews.length > 0
      ? stationReviews
      : isMvDistribution
        ? [
          {
            id: `fallback-${submission.id}`,
            status: mvFallbackStationStatus,
            result_note: null,
            track_results: null,
            updated_at: submission.updated_at,
            station: { name: "영상물등급위원회" },
          },
        ]
        : stationReviews;
  const activeRadioReview = renderStationReviews.find(review => review.id === radioLinksModal?.reviewId);
  const activeRadioStationCode = activeRadioReview?.station && "code" in activeRadioReview.station ? activeRadioReview.station.code : null;
  const openSubmissionDownload = React.useCallback(
    async (assetPath: MvReviewAssetPath) => {
      await downloadEndpointFile(
        `/api/submissions/${submission.id}/${assetPath}`,
        mvReviewFallbackFilenames[assetPath],
        guestToken
          ? { headers: { "X-Submission-Guest-Token": guestToken } }
          : undefined,
      );
    },
    [guestToken, submission.id],
  );

  const handleGuideDownload = async () => {
    if (!isMvDistribution) {
      alert("온라인 업로드용 뮤직비디오 심의만 가이드를 다운로드할 수 있습니다.");
      return;
    }
    if (!canDownloadMvReviewAssets) {
      alert("심의 등급 확정 후 다운로드할 수 있습니다.");
      return;
    }
    try {
      await openSubmissionDownload("mv-guide");
    } catch (error) {
      alert(error instanceof Error ? error.message : "가이드를 불러오지 못했습니다.");
    }
  };

  const handleCertificateDownload = async () => {
    if (!isMvDistribution) {
      alert("온라인 업로드용 뮤직비디오 심의만 필증을 다운로드할 수 있습니다.");
      return;
    }
    if (!canDownloadMvReviewAssets) {
      alert("심의 등급 확정 후 다운로드할 수 있습니다.");
      return;
    }
    if (!submission.certificate_b2_path) {
      alert("필증이 아직 업로드되지 않았습니다.");
      return;
    }
    try {
      await openSubmissionDownload("mv-certificate");
    } catch (error) {
      alert(error instanceof Error ? error.message : "필증을 불러오지 못했습니다.");
    }
  };

  const buildTrackSummary = React.useCallback(
    (review: { track_results?: TrackReviewResult[] | null; status: string; station?: { code?: string | null; name?: string | null } | null }) =>
      summarizeTrackResults(resolveStationTrackResults(review.track_results, albumTracks, review.status, review.station)),
    [albumTracks],
  );
  const paymentStatusLabel =
    normalizePaymentStatusLabel(
      submission.payment_status,
      isPaymentDone,
      isPaymentPending,
      submission.payment_method,
    );
  const canRetryCardPayment =
    submission.payment_method !== "BANK" && !["PAID", "REFUNDED"].includes(submission.payment_status);
  const openCartForPayment = async () => {
    if (checkoutPendingRef.current || submission.payment_status === "REFUNDED") return;
    setCheckoutError(null);
    if (submission.payment_method === "BANK") {
      // Deposit instructions remain distinct from cancelling an unpaid bank
      // order; an already-transferred deposit must not prompt another payment.
      if (guestToken) {
        const remember = submission.current_order_id ? rememberGuestSubmissionOrderEntries : addGuestSubmissionCartEntries;
        remember([{ submissionId: submission.id, guestToken }]);
      }
      router.push(`${localePrefix}/mypage/${submission.current_order_id ? "orders" : "cart"}?focus=${submission.id}`);
      return;
    }
    checkoutPendingRef.current = true;
    setIsPreparingCheckout(true);
    try {
      let href: string;
      if (submission.current_order_id) {
        const proofs = guestToken ? Object.fromEntries([
          ...readGuestSubmissionOrderEntries().map(entry => [entry.submissionId, entry.guestToken]),
          [submission.id, guestToken],
        ]) as Record<string, string> : {};
        if (Object.keys(proofs).length > 100) throw new Error("이 주문의 비회원 조회 정보를 확인하지 못했습니다. 주문내역에서 다시 진행해주세요.");
        const previousOrderId = submission.current_order_id;
        const prepared = await prepareOrderCheckout({ orderId: previousOrderId, guestTokensBySubmissionId: proofs, localePrefix });
        href = prepared.href;
        setSubmission(current => current.current_order_id === previousOrderId && current.payment_status !== "PAID"
          ? { ...current, current_order_id: null, payment_status: "UNPAID", status: "SUBMITTED" } : current);
      } else {
        if (guestToken && !addGuestSubmissionCartEntries([{ submissionId: submission.id, guestToken }])) {
          throw new Error("비회원 결제 정보를 이 브라우저에 저장하지 못했습니다. 조회 코드를 보관하고 브라우저 저장을 허용한 뒤 다시 확인해주세요.");
        }
        href = buildSubmissionCheckoutHref([submission.id], localePrefix);
      }
      router.push(href);
      router.refresh();
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "결제 준비를 완료하지 못했습니다. 주문내역을 새로고침한 뒤 다시 시도해주세요.");
    } finally {
      checkoutPendingRef.current = false;
      setIsPreparingCheckout(false);
    }
  };
  const mvSongTitleDisplay =
    submission.mv_song_title_official ||
    submission.mv_song_title ||
    submission.mv_song_title_kr ||
    submission.mv_song_title_en ||
    "-";
  const paymentFeedbackState = customerPaymentFeedback(paymentState, submission.payment_status);
  const paymentFeedback = paymentFeedbackState ? {
    title: {
      paid: "결제가 완료되었습니다.",
      refunded: "환불이 완료되었습니다.",
      checking: "결제 승인 상태를 확인 중입니다. 잠시 후 진행상황을 다시 확인해주세요.",
      cancelled: "결제가 취소되었습니다.",
      failed: "결제가 완료되지 않았습니다.",
    }[paymentFeedbackState],
    tone: paymentFeedbackState === "paid"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-100"
      : paymentFeedbackState === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-300/20 dark:bg-rose-500/10 dark:text-rose-100"
        : "border-primary/20 bg-primary/8 text-primary dark:border-[#2997ff]/30 dark:bg-[#2997ff]/12 dark:text-[#8bc3ff]",
  } : null;
  const stationSummary = renderStationReviews.reduce(
    (acc, review) => {
      const summary = buildTrackSummary(review);
      const normalizedStatus = normalizeStationReviewStatus(review.status);
      const display = getStationReviewDisplayStatus(review, { albumTracks });
      const hasDelivery = display.isComplete;
      const hasSubmission = normalizedStatus === "SENT" || display.key !== "WAITING_SUBMISSION";
      const isProcessing = hasSubmission && !hasDelivery;
      const hasActionNeeded = display.needsAttention || summary.counts.rejected > 0;
      const hasApproved = summary.counts.approved > 0 || display.key === "APPROVED";

      acc.total += 1;
      if (hasSubmission) acc.submitted += 1;
      if (hasDelivery) acc.delivered += 1;
      if (isProcessing) acc.processing += 1;
      if (hasActionNeeded) acc.actionNeeded += 1;
      if (hasApproved) acc.approved += 1;
      return acc;
    },
    {
      total: 0,
      submitted: 0,
      delivered: 0,
      processing: 0,
      actionNeeded: 0,
      approved: 0,
    },
  );
  const expectedStationTotal = Math.max(
    stationSummary.total,
    mvOptions?.length ?? 0,
    packageInfo?.station_count ?? 0,
  );
  const hasAllExpectedStationResults =
    expectedStationTotal > 0 && stationSummary.delivered >= expectedStationTotal;
  const isMvResultDelivered = isMvDistribution
    ? hasMvDistributionResult
    : isMvBroadcast && (isReviewComplete || hasAllExpectedStationResults);
  const hasSubmissionLevelResultSignal =
    isResultReady || Boolean(submission.result_status || submission.result_notified_at);
  const displayResultDelivered = isMvSubmission
    ? isMvResultDelivered || (isMvDistribution && hasSubmissionLevelResultSignal)
    : hasAllExpectedStationResults;
  const displayStatus = buildSubmissionDisplayStatus({
    submissionStatus: submission.status,
    paymentStatus: submission.payment_status,
    paymentMethod: submission.payment_method,
    isPaymentDone,
    isPaymentPending,
    stationTotal: expectedStationTotal,
    stationSubmitted: stationSummary.submitted,
    stationDelivered: stationSummary.delivered,
    isMvSubmission,
    resultDelivered: displayResultDelivered,
  });
  const handlePrimaryStatusAction = () => {
    if (displayStatus.primaryAction === "order-status") {
      if (guestToken) rememberGuestSubmissionOrderEntries([{ submissionId: submission.id, guestToken }]);
      router.push(`${localePrefix}/mypage/orders?focus=${encodeURIComponent(submission.id)}`);
      return;
    }
    if (submission.current_order_id && ["payment-info", "retry-payment"].includes(displayStatus.primaryAction ?? "")) {
      void openCartForPayment();
      return;
    }
    if (displayStatus.primaryAction === "payment-info") {
      setShowPaymentInfo(true);
      return;
    }
    if (displayStatus.primaryAction === "retry-payment" && canRetryCardPayment) {
      void openCartForPayment();
      return;
    }
    if (displayStatus.primaryAction === "station-review") {
      document
        .getElementById("station-review-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const handleOpenSubmissionForm = () => {
    setIsSubmissionFormOpen(true);
    window.setTimeout(() => {
      document
        .getElementById("submission-form-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  const hasFinalResultStarted = isMvDistribution
    ? hasMvDistributionResult
    : stationSummary.delivered > 0 || hasResultDeliverySignal;
  const hasFinalResultDone = isMvDistribution
    ? hasMvDistributionResult
    : isMvBroadcast
      ? displayResultDelivered
      : hasAllExpectedStationResults;
  const hasStationSubmissionDone =
    isPaymentDone &&
    ((expectedStationTotal > 0 && stationSummary.submitted >= expectedStationTotal) ||
      hasFinalResultStarted);
  const mvReceptionStarted =
    isMvSubmission &&
    isPaymentDone &&
    (submission.status === "IN_PROGRESS" ||
      submission.status === "RESULT_READY" ||
      submission.status === "COMPLETED" ||
      stationSummary.submitted > 0 ||
      hasFinalResultStarted);
  const stepThreeState: "done" | "active" | "pending" = !isPaymentDone
    ? "pending"
    : isMvSubmission
      ? hasFinalResultDone
        ? "done"
        : "active"
      : hasStationSubmissionDone
      ? "done"
      : "active";
  const finalProcessLabel = isMvSubmission ? "결과 통보" : "적격/부적격 통보";
  const processSteps: Array<{
    label: string;
    value: string;
    state: "done" | "active" | "pending";
  }> = [
    {
      label: isMvSubmission ? "신청 완료" : "신청서 작성 및 제출",
      value: submission.status === "DRAFT" ? "신청서 작성 중" : "신청서 제출 완료",
      state: submission.status === "DRAFT" ? "active" : "done",
    },
    {
      label: isMvSubmission ? "결제 완료" : "결제 확인",
      value: paymentStatusLabel,
      state: isPaymentDone
        ? "done"
        : submission.status === "DRAFT"
          ? "pending"
          : "active",
    },
    {
      label: isMvSubmission ? "접수 진행" : "방송사 접수",
      value: isMvSubmission
        ? !isPaymentDone
          ? "결제 완료 후 접수 진행"
          : hasFinalResultDone
            ? "접수 진행 완료"
            : mvReceptionStarted
              ? "접수 진행 중"
              : "접수예정"
        : !isPaymentDone
          ? "결제 확인 후 접수 시작"
          : stepThreeState === "done"
            ? "방송사 접수 완료"
            : stationSummary.submitted > 0
              ? "방송사별 접수 진행 중"
              : "접수예정",
      state: stepThreeState,
    },
    {
      label: finalProcessLabel,
      value: isMvSubmission
        ? hasFinalResultDone
          ? isMvDistribution && submission.mv_desired_rating
            ? `${mvRatingLabel(submission.mv_desired_rating)} 결과 통보 완료`
            : "결과 통보 완료"
          : "결과 등급 통보 대기"
        : hasFinalResultDone
          ? "방송사별 결과 반영 완료"
          : hasFinalResultStarted
            ? "방송사별 결과 순차 반영"
            : "방송사별 결과 대기",
      state: hasFinalResultDone
        ? "done"
        : hasFinalResultStarted
          ? "active"
          : "pending",
    },
  ];
  const firstIncompleteProcessStepIndex = processSteps.findIndex(
    (step) => step.state !== "done",
  );
  const currentProcessStepIndex =
    firstIncompleteProcessStepIndex >= 0
      ? firstIncompleteProcessStepIndex
      : processSteps.length - 1;
  const currentProcessStep = processSteps[currentProcessStepIndex];
  const currentProcessStageLabel = `현재 ${currentProcessStepIndex + 1}단계`;
  const currentStatusLabel =
    !isMvSubmission && isPaymentDone
      ? currentProcessStep.value
      : displayStatus.currentLabel;
  const renderProcessTimeline = () => (
    <div className="mt-6 border-t-2 border-[#111111] pt-5 dark:border-[#f2cf27]">
      <h3 id="review-process-heading" className={detailKickerClass}>
        심의 진행 단계
      </h3>
      <ol
        aria-labelledby="review-process-heading"
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {processSteps.map((step, index) => (
          <li
            key={step.label}
            aria-current={
              index === currentProcessStepIndex ? "step" : undefined
            }
            className={[
              "rounded-[8px] border-2 px-4 py-3 text-sm transition",
              step.state === "done"
                ? "border-[#111111] bg-[#1556a4] text-white dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f]"
                : step.state === "active"
                  ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
                  : "border-border bg-background text-muted-foreground",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black",
                  step.state === "done"
                    ? "border-white/70 bg-white/20 text-white dark:border-[#06111f]/40 dark:text-[#06111f]"
                    : step.state === "active"
                      ? "border-[#111111] bg-[#111111] text-[#f2cf27]"
                      : "border-border bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {index + 1}
              </span>
              <span className="rounded-[6px] border border-current/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-normal">
                {step.state === "done"
                  ? "완료"
                  : step.state === "active"
                    ? "진행"
                    : "대기"}
              </span>
            </div>
            <p className="mt-3 font-black tracking-normal">{step.label}</p>
          </li>
        ))}
      </ol>
    </div>
  );
  const renderStationReviewSection = () => (
    <div id="station-review-section" className={detailPanelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={detailKickerClass}>
          방송국별 현황
        </p>
      </div>
      {submission.result_status || submission.result_memo ? (
        <div className="mt-4 rounded-[8px] border border-border bg-background p-4">
          <p className="text-sm font-semibold">
            {resultStatusLabelMap[submission.result_status as ResultStatus] ?? "심의 결과 안내"}
          </p>
          {submission.result_memo ? <p className="mt-2 whitespace-pre-wrap text-sm"><span data-no-translate>{submission.result_memo}</span></p> : null}
        </div>
      ) : null}
      {!isMvSubmission ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="bauhaus-status-chip bauhaus-status-chip--info bauhaus-status-chip--compact">
            결과 {stationSummary.delivered}/{expectedStationTotal}
          </span>
          {stationSummary.actionNeeded > 0 ? (
            <span className="bauhaus-status-chip bauhaus-status-chip--waiting bauhaus-status-chip--compact">
              확인 필요 {stationSummary.actionNeeded}곳
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5">
        {renderStationReviews && renderStationReviews.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {renderStationReviews.map((review) => {
              const trackInfo = buildTrackSummary(review);
              const currentStatus = getStationReviewDisplayStatus(review, { albumTracks });
              const note = review.result_note?.trim() || null;
              const hasApprovedTrack = trackInfo.counts.approved > 0;
              const canOpenRadioLinks =
                !isMvSubmission &&
                !["REJECTED", "NEEDS_FIX"].includes(review.status) &&
                (hasApprovedTrack || review.status === "APPROVED");
              const stationCode =
                review.station && "code" in review.station
                  ? review.station.code
                  : null;
              const hasTrackDetails = trackInfo.results.length > 0;
              const totalTracksForDisplay = trackInfo.counts.total;
              const pendingGap = Math.max(
                totalTracksForDisplay -
                  (trackInfo.counts.approved +
                    trackInfo.counts.rejected +
                    trackInfo.counts.pending),
                0,
              );
              const pendingCount = trackInfo.counts.pending + pendingGap;
              const summaryCounts = {
                approved: trackInfo.counts.approved,
                rejected: trackInfo.counts.rejected,
                pending: pendingCount,
              };
              const trackSummaryLine =
                hasTrackDetails && totalTracksForDisplay > 1
                  ? buildTrackSummaryText(summaryCounts, " · ")
                  : null;
              const resolvedResultNote = note;
              const mvReviewAssets =
                isMvDistribution &&
                canDownloadMvReviewAssets &&
                submission.mv_desired_rating
                  ? {
                      ratingLabel: mvRatingLabel(submission.mv_desired_rating),
                      hasCertificate: Boolean(submission.certificate_b2_path),
                      certificateName:
                        submission.certificate_original_name?.trim() || null,
                    }
                  : null;
              const resultDisplayStatus = mvReviewAssets
                ? {
                    label:
                      submission.mv_desired_rating === "REJECT"
                        ? "부적격"
                        : "적격",
                    tone:
                      submission.mv_desired_rating === "REJECT"
                        ? rejectedDetailResultTone
                        : approvedDetailResultTone,
                  }
                : currentStatus;
              const shouldOpenResultModal =
                hasTrackDetails ||
                Boolean(resolvedResultNote) ||
                Boolean(mvReviewAssets);

              const handleResultClick = (event: React.MouseEvent<HTMLButtonElement>) => {
                radioReturnFocusRef.current = event.currentTarget;
                if (shouldOpenResultModal) {
                  setTrackResultModal({
                    reviewId: review.id,
                    stationName: review.station?.name ?? "-",
                    stationCode,
                    resultNote: resolvedResultNote,
                    resultLabel: resultDisplayStatus.label,
                    resultTone: resultDisplayStatus.tone,
                    canRequestRadio: canOpenRadioLinks,
                    ...(mvReviewAssets ? { mvReviewAssets } : {}),
                    summary: trackInfo,
                  });
                  return;
                }
                if (canOpenRadioLinks) {
                  openRadioLinks(review.id);
                }
              };
              const stationName = review.station?.name?.trim() || stationCode?.trim() || "방송국";

              return (
                <div
                  key={review.id}
                  className="min-w-0 rounded-[8px] border-2 border-[#111111] bg-background p-3 text-sm shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      className="flex min-w-0 items-center gap-3"
                      title={stationName}
                    >
                      <StationLogoWithFallback station={review.station} />
                      <div className="min-w-0">
                        <p
                          className="text-[11px] font-semibold uppercase tracking-normal text-muted-foreground"
                          title={formatDateTime(review.updated_at)}
                          aria-label={`Updated ${formatDateTime(review.updated_at)}`}
                        >
                          Updated{" "}
                          <span className="text-foreground/72">
                            {formatDateTime(review.updated_at)}
                          </span>
                        </p>
                      </div>
                    </div>
                    <ReviewResultControl
                      label={resultDisplayStatus.label}
                      tone={resultDisplayStatus.tone}
                      summary={trackSummaryLine}
                      onClick={handleResultClick}
                      aria-label={[stationName, resultDisplayStatus.label, trackSummaryLine].filter(Boolean).join(" · ")}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[8px] border-2 border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
            진행 정보 준비 중
          </div>
        )}
      </div>
    </div>
  );

  const openRadioLinks = (reviewId: string) => setRadioLinksModal({ reviewId, open: true });
  const closeRadioLinks = React.useCallback(() => setRadioLinksModal(previous => previous ? { ...previous, open: false } : null), []);

  React.useEffect(() => {
    setSubmission(initialSubmission);
    setStationReviews(initialStationReviews ?? []);
    setFiles(initialFiles ?? []);
  }, [initialFiles, initialStationReviews, initialSubmission]);

  const fetchLatest = React.useCallback(async () => {
    if (!supabase) return;
    const refresh = ++latestRefresh.current;
    const [submissionResult, related] = await Promise.all([
      supabase
        .from("submissions")
        .select(SUBMISSION_USER_DETAIL_SELECT)
        .eq("id", submissionId)
        .maybeSingle(),
      loadSubmissionDetailRelations(supabase, submissionId),
    ]);
    if (refresh !== latestRefresh.current) return;

    const submissionData = submissionResult.data as Submission | null;
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

    if (related.reviews.data) {
      const reviews = (related.reviews.data as StationReview[]).filter(review =>
        (submissionData?.type ?? initialSubmission.type) !== "MV_BROADCAST" ||
        !["MV_BROADCAST", "MV_ONLINE"].includes(review.station?.code ?? ""));
      setStationReviews((previous) => preservePendingStationReviews(previous, reviews));
    }
    if (related.files.data) setFiles(related.files.data);
  }, [submissionId, supabase, initialSubmission.type]);

  React.useEffect(() => {
    // The server already supplies the form, review results, and file metadata.
    // Retry an incomplete response without duplicating a successful initial load.
    if (!initialDataComplete) void fetchLatest();
  }, [fetchLatest, initialDataComplete]);

  React.useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return;
    const intervalId = window.setInterval(() => {
      router.refresh();
    }, refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [refreshIntervalMs, router]);

  React.useEffect(() => {
    if (!enableRealtime || !supabase) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void fetchLatest();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enableRealtime, fetchLatest, supabase]);

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
      if (!isMvDistribution) {
        throw new Error("온라인 업로드용 뮤직비디오 심의만 등급표를 다운로드할 수 있습니다.");
      }
      if (!canDownloadMvReviewAssets) {
        throw new Error("심의 등급 확정 후 다운로드할 수 있습니다.");
      }
      if (!submission.mv_desired_rating) {
        throw new Error("등급이 설정되지 않았습니다.");
      }
      await openSubmissionDownload("mv-rating-image");
    } catch (error) {
      alert(error instanceof Error ? error.message : "등급 이미지를 불러오지 못했습니다.");
    } finally {
      setIsRatingDownloading(false);
    }
  };

  return (
    <div className={`mx-auto min-w-0 w-full max-w-6xl [overflow-wrap:anywhere] ${resultsOnly ? "p-4 sm:p-6" : "px-4 py-8 sm:px-6 sm:py-10"}`}>
      {resultsOnly ? (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-black">{submission.title ? <span data-no-translate>{submission.title}</span> : "심의 결과"}</h1>
            {submission.artist_name ? <p data-no-translate className="mt-1 text-sm text-muted-foreground">{submission.artist_name}</p> : null}
            <p className="mt-3 text-sm font-semibold">{currentStatusLabel}</p>
          </div>
          {renderStationReviewSection()}
          {submission.type === "ALBUM" && hasAllExpectedStationResults ? (
            <div className="mt-6"><BroadcastSupportPanel submission={submission} stationReviews={stationReviews} isEnglish={localePrefix === "/en"} /></div>
          ) : null}
        </div>
      ) : <>
      {submission.payment_status === "PAID" ? <SubmissionSupplements submissionId={submissionId} guestToken={guestToken} /> : null}
      {checkoutError && <p role="alert" className={`mb-5 rounded-lg border-2 p-4 text-sm ${brandStatusTones.danger}`}>{checkoutError}</p>}
      {paymentFeedback ? (
        <div
          className={`mb-6 rounded-[10px] border-2 px-5 py-4 shadow-[5px_5px_0_#111111] dark:shadow-[5px_5px_0_#f2cf27] ${paymentFeedback.tone}`}
        >
          <p className="text-xs font-black uppercase tracking-normal opacity-80">
            Payment
          </p>
          <h2 className="mt-2 text-lg font-black">{paymentFeedback.title}</h2>
        </div>
      ) : null}
      {showPaymentInfo ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-4">
          <button
            type="button"
            onClick={() => setShowPaymentInfo(false)}
            className="absolute inset-0 bg-black/50"
            aria-label="결제 안내 닫기"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="결제 안내"
            className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={detailKickerClass}>
                  결제 안내
                </p>
                <h2 className="mt-2 text-lg font-black text-foreground">
                  {packageInfo?.name ?? submission.title ?? "신청 상품"}
                </h2>
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
                입금 계좌
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
                24시간 내 확인 · 입금자명이 다르면 문의해주세요.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openCartForPayment()}
                  disabled={isPreparingCheckout}
                  className="rounded-[8px] border-2 border-[#111111] bg-[#1556a4] px-4 py-2 text-xs font-black uppercase tracking-normal text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#0f4f99] dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
                >
                  {submission.current_order_id ? "주문 내역 보기" : "장바구니"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] px-5 py-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute right-0 top-0 h-6 w-32 bg-[#1556a4] dark:bg-[#3f8ad8]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-4 w-24 bg-[#d9362c] dark:bg-[#ff6258]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-4 w-40 bg-[#f2cf27]" />
        <div className="relative z-10">
          <div className="min-w-0">
            <p className="bauhaus-kicker">
              Submission Detail
            </p>
            <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
              {submission.title ? <span data-no-translate>{submission.title}</span> : (submission.is_oneclick ? "발매된 음반 · URL 접수" : "제목 미입력")}
            </h1>
            <p className="mt-3 text-lg font-semibold text-foreground/82 sm:text-xl">
              {submission.artist_name ? <span data-no-translate>{submission.artist_name}</span> : (submission.is_oneclick ? "앨범 링크 확인 대기" : "아티스트 미입력")}
            </p>
            <div className="mt-6 w-full rounded-[8px] border-2 border-[#111111] bg-white/85 p-5 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#111111]/55 dark:shadow-[4px_4px_0_#f2cf27]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  현재 상태
                </p>
                <p className="text-left text-[11px] font-black uppercase tracking-normal text-muted-foreground sm:text-right">
                  Updated{" "}
                  <span className="font-semibold tracking-normal text-foreground/72">
                    {formatDateTime(submission.updated_at)}
                  </span>
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-black text-foreground">
                  {currentStatusLabel}
                </h2>
                {!isMvSubmission && isPaymentDone && !hasFinalResultDone ? (
                  <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-2.5 py-1 text-xs font-black text-[#111111]">
                    {currentProcessStageLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {displayStatus.primaryActionLabel ? (
                  <button
                    type="button"
                    onClick={handlePrimaryStatusAction}
                    disabled={isPreparingCheckout}
                    aria-busy={isPreparingCheckout}
                    className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 py-2 text-sm font-black text-white shadow-[3px_3px_0_#1556a4] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[3px_3px_0_#3f8ad8]"
                  >
                    {isPreparingCheckout ? "결제 준비 중..." : displayStatus.primaryActionLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleOpenSubmissionForm}
                  className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-5 py-2 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-white dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
                >
                  신청서 확인
                </button>
              </div>
              {!isMvSubmission && isPaymentDone && !hasFinalResultDone
                ? renderProcessTimeline()
                : null}
            </div>
          </div>
        </div>
      </section>

      {isPaymentDone ? (
        <div className="mt-8">
          {renderStationReviewSection()}
          {submission.type === "ALBUM" && hasAllExpectedStationResults ? (
            <div className="mt-6"><BroadcastSupportPanel submission={submission} stationReviews={stationReviews} isEnglish={localePrefix === "/en"} /></div>
          ) : null}
        </div>
      ) : null}

      {/* 관리자용 등급/필증 편집 UI는 관리자 페이지에서만 제공 */}
      {/* 사용자 노출 방지를 위해 숨김: 신청 내역 TXT 다운로드 */}

      <div
        className={`mt-8 grid min-w-0 gap-4 ${!isReceptionInfoOpen && !isSubmissionFormOpen && !isAttachmentsOpen ? "lg:grid-cols-3" : ""}`}
        data-testid="submission-record-panels"
      >
        <div className="order-2">
          <div className={detailPanelClass}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className={detailKickerClass}>접수 정보</p>
              <button
                type="button"
                onClick={() => setIsReceptionInfoOpen((prev) => !prev)}
                aria-label={isReceptionInfoOpen ? "접수 정보 닫기" : "접수 정보 열기"}
                aria-expanded={isReceptionInfoOpen}
                className={`${detailToggleButtonClass} shrink-0`}
              >
                <span aria-hidden>{isReceptionInfoOpen ? "▲" : "▼"}</span>
                <span>{isReceptionInfoOpen ? "접기" : "펼치기"}</span>
              </button>
            </div>
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
                        {getAlbumPackageLabel(packageInfo?.name, packageInfo?.station_count)}
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
                    {paymentStatusLabel}
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
              </div>
            ) : null}
          </div>
        </div>
        <div id="submission-form-section" className={`order-4 ${detailPanelClass}`}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className={detailKickerClass}>작성 신청서</p>
            <button
              type="button"
              onClick={() => setIsSubmissionFormOpen((prev) => !prev)}
              aria-label={isSubmissionFormOpen ? "작성 신청서 닫기" : "작성 신청서 열기"}
              aria-expanded={isSubmissionFormOpen}
              className={`${detailToggleButtonClass} shrink-0`}
            >
              <span aria-hidden>{isSubmissionFormOpen ? "▲" : "▼"}</span>
              <span>{isSubmissionFormOpen ? "접기" : "펼치기"}</span>
            </button>
          </div>
          {isSubmissionFormOpen ? (
            <>
              <div className="mt-4 grid gap-4 text-base text-foreground md:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {submission.type === "ALBUM" ? "앨범 제목" : "영상 제목"}
                  </p>
                  <p className="mt-1 font-semibold"><span data-no-translate>{submission.title || "-"}</span></p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">아티스트명</p>
                  <p className="mt-1 font-semibold">
                    <span data-no-translate>{submission.artist_name || "-"}</span>
                    {submission.artist_name_kr ? <span data-no-translate>{` / ${submission.artist_name_kr}`}</span> : null}
                    {submission.artist_name_en ? <span data-no-translate>{` / ${submission.artist_name_en}`}</span> : null}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">AI 활용 여부</p>
                  <p className="mt-1 font-semibold">
                    {aiUsageLabel(submission.ai_used)}
                  </p>
                </div>
                {showApplicantInfo ? (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">신청자</p>
                      <p className="mt-1 font-semibold">
                        <span data-no-translate>{submission.applicant_name || "-"}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">신청자 연락처</p>
                      <p className="mt-1 font-semibold">
                        <span data-no-translate>{submission.applicant_phone || "-"}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">신청자 이메일</p>
                      <p className="mt-1 font-semibold">
                        <span data-no-translate>{submission.applicant_email || "-"}</span>
                      </p>
                    </div>
                  </>
                ) : null}
                <div>
                  <p className="text-sm text-muted-foreground">유통사</p>
                  <p className="mt-1 font-semibold">
                    <span data-no-translate>{submission.distributor || "-"}</span>
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">제작사</p>
                  <p className="mt-1 font-semibold">
                    <span data-no-translate>{submission.production_company || "-"}</span>
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
                    <span data-no-translate>{submission.genre || "-"}</span>
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">이전 발매</p>
                  <p className="mt-1 font-semibold">
                    <span data-no-translate>{submission.previous_release || "-"}</span>
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
                    <span data-no-translate>{submission.artist_members || "-"}</span>
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">멜론·지니 앨범 링크</p>
                  <p className="mt-1 font-semibold">
                    {submission.melon_url || "-"}
                  </p>
                </div>
                {isMvSubmission ? (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">러닝타임</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_runtime || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">포맷</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_format || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">감독</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_director || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">주연</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_lead_actor || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">스토리라인</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_storyline || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">제작사</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_production_company || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">에이전시</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_agency || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">앨범 제목</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_album_title || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">제작일</p>
                      <p className="mt-1 font-semibold">
                        {submission.mv_production_date ? formatDateTime(submission.mv_production_date) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">배급사</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_distribution_company || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">사업자등록번호</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_business_reg_no || "-"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">용도</p>
                      <p className="mt-1 font-semibold"><span data-no-translate>{submission.mv_usage || "-"}</span></p>
                    </div>
                    {isMvDistribution ? (
                      <div>
                        <p className="text-xs text-muted-foreground">심의 등급</p>
                        <p className="mt-1 font-semibold">{submission.mv_desired_rating || "-"}</p>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs text-muted-foreground">곡 제목</p>
                      <p data-no-translate className="mt-1 font-semibold">{mvSongTitleDisplay}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">작곡/작사/편곡</p>
                      <p className="mt-1 font-semibold">
                        <span data-no-translate>{submission.mv_composer || "-"}</span> / <span data-no-translate>{submission.mv_lyricist || "-"}</span> /{" "}
                        <span data-no-translate>{submission.mv_arranger || "-"}</span>
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs text-muted-foreground">메모</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                        <span data-no-translate>{submission.mv_memo || "-"}</span>
                      </p>
                    </div>
                    {submission.mv_lyrics ? (
                      <div className="md:col-span-2">
                        <p className="text-xs text-muted-foreground">가사</p>
                        <div className={`${detailSubPanelClass} mt-2 whitespace-pre-wrap p-3 text-sm text-foreground`}>
                          <span data-no-translate>{submission.mv_lyrics}</span>
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
                        <span data-no-translate>{submission.previous_release || "-"}</span>
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
                            {track.track_title || track.track_title_kr || track.track_title_en ? <span data-no-translate>{track.track_title || track.track_title_kr || track.track_title_en}</span> : "제목 미입력"}
                            {track.is_title ? " · 타이틀" : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            가수 <span data-no-translate>{track.performer || submission.artist_name || "-"}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            작곡 <span data-no-translate>{track.composer || "-"}</span> / 작사 <span data-no-translate>{track.lyricist || "-"}</span> / 편곡{" "}
                            <span data-no-translate>{track.arranger || "-"}</span>
                          </p>
                          {track.lyrics ? (
                            <details className="mt-1 text-xs text-muted-foreground">
                              <summary className="cursor-pointer">가사 보기</summary>
                              <div className="mt-1 whitespace-pre-wrap text-foreground">
                                <span data-no-translate>{track.lyrics}</span>
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
        </div>

        <div className={`order-5 ${detailPanelClass}`}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className={detailKickerClass}>첨부 파일</p>
            <button
              type="button"
              onClick={() => setIsAttachmentsOpen((prev) => !prev)}
              aria-label={isAttachmentsOpen ? "첨부 파일 닫기" : "첨부 파일 열기"}
              aria-expanded={isAttachmentsOpen}
              className={`${detailToggleButtonClass} shrink-0`}
            >
              <span aria-hidden>{isAttachmentsOpen ? "▲" : "▼"}</span>
              <span>{isAttachmentsOpen ? "접기" : "펼치기"}</span>
            </button>
          </div>
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
        </div>


      </div>

      </>}

      {trackResultModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-4"
          onClick={() => setTrackResultModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={trackResultModal.mvReviewAssets ? "심의 결과" : "트랙별 결과"}
            className="max-h-[calc(100dvh-2rem)] min-w-0 w-full max-w-lg overflow-y-auto overscroll-contain rounded-[10px] border-2 border-[#111111] bg-background p-4 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <p className={detailKickerClass}>
              {trackResultModal.mvReviewAssets ? "심의 결과" : "트랙별 결과"}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {trackResultModal.stationName ?? "-"}
            </h3>
            {trackResultModal.resultLabel ? (
              <div className="mt-3">
                <span
                  className={`bauhaus-status-chip bauhaus-status-chip--compact ${trackResultModal.resultTone ?? ""}`}
                >
                  {trackResultModal.resultLabel}
                </span>
              </div>
            ) : null}
            {trackResultModal.summary.counts.total > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {buildTrackSummaryText(trackResultModal.summary.counts, " · ")}
              </p>
            ) : null}
            {trackResultModal.summary.results.length > 0 ? (
              <div className="mt-4 space-y-2 sm:max-h-80 sm:overflow-y-auto">
                {trackResultModal.summary.results.map((track, index) => {
                  const status =
                    track.status === "APPROVED"
                      ? { label: "적격", tone: approvedDetailResultTone }
                      : track.status === "REJECTED"
                        ? { label: "부적격", tone: rejectedDetailResultTone }
                        : { label: "대기", tone: "bg-slate-500/10 text-slate-600 dark:text-slate-300" };
                  const trackLabel =
                    track.title ||
                    albumTracks.find(
                      (base) =>
                        (track.track_id && base.id === track.track_id) ||
                        (typeof track.track_no === "number" &&
                          base.track_no === track.track_no),
                    )?.track_title || null;
                  return (
                    <div
                      key={`${track.track_id ?? index}-${track.track_no ?? index}`}
                      className={`${detailSubPanelClass} flex items-start justify-between gap-3 px-3 py-2 text-sm`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold leading-relaxed text-foreground">
                          {track.track_no ? `${track.track_no}. ` : ""}
                          {trackLabel ? <span data-no-translate>{trackLabel}</span> : "트랙"}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center justify-center rounded-[6px] border-2 border-[#111111] px-3 py-1 text-xs font-black dark:border-[#f2cf27] ${status.tone}`}
                      >
                        {status.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {trackResultModal.resultNote ? (
              <div className="mt-4 rounded-[8px] border-2 border-[#1556a4] bg-[#1556a4]/5 p-4 dark:border-[#8fb7e8] dark:bg-[#0f1d2e]">
                <p className="text-xs font-black uppercase tracking-normal text-[#1556a4] dark:text-[#b9d8ff]">
                  심의 결과 메모
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80 dark:text-[#d7e7ff]">
                  <span data-no-translate>{trackResultModal.resultNote}</span>
                </p>
              </div>
            ) : null}
            {trackResultModal.mvReviewAssets ? (
              <div className="mt-5 border-t-2 border-border pt-4">
                <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
                  뮤직비디오 결과 다운로드
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  심의 등급: {trackResultModal.mvReviewAssets.ratingLabel}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={handleRatingDownload}
                    disabled={isRatingDownloading}
                    className={`${detailActionButtonClass} min-h-[64px] flex-col items-start text-left`}
                  >
                    <span>{isRatingDownloading ? "준비 중..." : "등급 이미지"}</span>
                    <span className="text-[11px] font-semibold opacity-70">
                      {trackResultModal.mvReviewAssets.ratingLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCertificateDownload}
                    disabled={!trackResultModal.mvReviewAssets.hasCertificate}
                    className={`${detailActionButtonClass} min-h-[64px] flex-col items-start text-left`}
                  >
                    <span>필증</span>
                    <span className="max-w-full truncate text-[11px] font-semibold opacity-70">
                      {trackResultModal.mvReviewAssets.hasCertificate
                        ? trackResultModal.mvReviewAssets.certificateName
                          ? <span data-no-translate>{trackResultModal.mvReviewAssets.certificateName}</span>
                          : "등록 완료"
                        : "업로드 대기"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleGuideDownload}
                    className={`${detailActionButtonClass} min-h-[64px] flex-col items-start text-left`}
                  >
                    <span>사용 가이드</span>
                    <span className="text-[11px] font-semibold opacity-70">
                      온라인 심의 공통 파일
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              {trackResultModal.canRequestRadio ? (
                <button
                  type="button"
                  onClick={() => {
                    openRadioLinks(trackResultModal.reviewId);
                    setTrackResultModal(null);
                  }}
                  className={detailActionButtonClass}
                >
                  {localePrefix === "/en" ? "Radio request guide" : "라디오 신청 가이드"}
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

      {radioLinksModal && activeRadioReview && (
        <RadioRequestDialog
          open={radioLinksModal.open}
          stationName={activeRadioReview.station?.name || activeRadioStationCode || (localePrefix === "/en" ? "Broadcaster" : "방송국")}
          isEnglish={localePrefix === "/en"}
          onClose={closeRadioLinks}
          returnFocusTarget={radioReturnFocusRef.current}
        >
          {submission.type === "ALBUM" ? (
            <BroadcastSupportPanel key={`${submission.id}:${activeRadioReview.id}`} submission={submission} stationReviews={[activeRadioReview]} isEnglish={localePrefix === "/en"} embedded />
          ) : (
            <div className="space-y-5">
              <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold leading-relaxed text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                {localePrefix === "/en"
                  ? "Music video approval is separate from audio approval. Check the audio track's review result before requesting radio airplay."
                  : "뮤직비디오 적격은 음원 적격과 별개입니다. 라디오 신청 전 해당 음원의 심의 결과를 확인하세요."}
              </p>
              <RadioStationGuideContent stationCode={activeRadioStationCode} stationName={activeRadioReview.station?.name} isEnglish={localePrefix === "/en"} />
            </div>
          )}
        </RadioRequestDialog>
      )}
    </div>
  );
}
