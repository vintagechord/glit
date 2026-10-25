import { normalizeStationReviewStatus } from "@/constants/review-status";
import { broadcastRatingLabels } from "@/lib/broadcast-rating";
import { getStationReviewTracks, isWbsReview, resolveStationTrackResults, summarizeTrackResults, type AlbumTrackMeta } from "@/lib/track-results";

type StationDisplayInput = {
  status?: string | null;
  age_rating?: string | null;
  track_results?: unknown;
  station?: { code?: string | null; name?: string | null } | null;
};

export type StationDisplayStatusKey =
  | "WAITING_SUBMISSION"
  | "WAITING_RESULT"
  | "IN_REVIEW"
  | "NEEDS_FIX"
  | "APPROVED"
  | "REJECTED"
  | "PARTIAL";

type StationDisplayStatusBase = {
  key: StationDisplayStatusKey;
  label: string;
  tone: string;
  isComplete: boolean;
  needsAttention: boolean;
};

const statusMap: Record<StationDisplayStatusKey, StationDisplayStatusBase> = {
  WAITING_SUBMISSION: {
    key: "WAITING_SUBMISSION",
    label: "접수예정",
    tone: "bauhaus-status-chip--waiting",
    isComplete: false,
    needsAttention: false,
  },
  WAITING_RESULT: {
    key: "WAITING_RESULT",
    label: "접수완료",
    tone: "bauhaus-status-chip--info",
    isComplete: false,
    needsAttention: false,
  },
  IN_REVIEW: {
    key: "IN_REVIEW",
    label: "접수완료",
    tone: "bg-violet-600 text-white dark:bg-violet-300 dark:text-[#06111f]",
    isComplete: false,
    needsAttention: false,
  },
  NEEDS_FIX: {
    key: "NEEDS_FIX",
    label: "보완 요청",
    tone: "bg-orange-500 text-white dark:bg-orange-300 dark:text-[#06111f]",
    isComplete: false,
    needsAttention: true,
  },
  APPROVED: {
    key: "APPROVED",
    label: "적격",
    tone: "bauhaus-status-chip--success",
    isComplete: true,
    needsAttention: false,
  },
  REJECTED: {
    key: "REJECTED",
    label: "부적격",
    tone: "bauhaus-status-chip--danger",
    isComplete: true,
    needsAttention: true,
  },
  PARTIAL: {
    key: "PARTIAL",
    label: "부분 적격",
    tone: "bg-orange-500 text-white dark:bg-orange-300 dark:text-[#06111f]",
    isComplete: true,
    needsAttention: true,
  },
};

export function buildStationTrackSummaryText(
  counts: { approved: number; rejected: number; pending: number },
  separator: string,
) {
  const parts = [`${counts.approved}곡 적격`];
  if (counts.rejected > 0) {
    parts.push(`${counts.rejected}곡 부적격`);
  }
  if (counts.pending > 0) {
    parts.push(`${counts.pending}곡 대기`);
  }
  return parts.join(separator);
}

export function getStationReviewDisplayStatus(
  review: StationDisplayInput,
  options: { showPartialTrackBreakdown?: boolean; albumTracks?: AlbumTrackMeta[] | null } = {},
) {
  const summary = summarizeTrackResults(resolveStationTrackResults(
    review.track_results,
    options.albumTracks,
    review.status,
    review.station,
  ));
  const rawStatus = (review.status ?? "").toUpperCase();
  const normalizedStatus = normalizeStationReviewStatus(rawStatus);

  const base = (() => {
    if (normalizedStatus === "NEEDS_FIX") {
      return statusMap.NEEDS_FIX;
    }
    if (rawStatus === "REJECTED") return statusMap.REJECTED;
    if (options.albumTracks &&
        getStationReviewTracks(options.albumTracks, review.station, review.track_results).length > 3 &&
        isWbsReview(review.station)) {
      return { ...statusMap.WAITING_RESULT, label: "심의곡 확인 필요", needsAttention: true };
    }
    if (summary.outcome === "PENDING" && (summary.counts.approved > 0 || summary.counts.rejected > 0)) {
      return statusMap.IN_REVIEW;
    }
    if (summary.outcome === "REJECTED") {
      return statusMap.REJECTED;
    }
    if (summary.outcome === "PARTIAL") {
      return statusMap.PARTIAL;
    }
    if (summary.outcome === "APPROVED") {
      return statusMap.APPROVED;
    }
    // A submission workflow state (RESULT_READY/COMPLETED) is not a station
    // decision, and must never manufacture an approval for a missing review.
    if (rawStatus === "APPROVED") return statusMap.APPROVED;
    if (rawStatus === "IN_PROGRESS" || rawStatus === "REVIEWING") {
      return statusMap.IN_REVIEW;
    }
    if (rawStatus === "SENT" || rawStatus === "RECEIVED" || normalizedStatus === "SENT") {
      return statusMap.WAITING_RESULT;
    }
    return statusMap.WAITING_SUBMISSION;
  })();

  const summaryText =
    (summary.counts.approved > 0 || summary.counts.rejected > 0) && options.showPartialTrackBreakdown
      ? buildStationTrackSummaryText(summary.counts, " / ")
      : null;

  return {
    ...base,
    ...(base.key === "APPROVED" && review.age_rating && broadcastRatingLabels[review.age_rating]
      ? { label: broadcastRatingLabels[review.age_rating] }
      : {}),
    summary,
    summaryText,
  };
}
