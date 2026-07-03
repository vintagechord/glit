import { normalizeStationReviewStatus } from "@/constants/review-status";
import { summarizeTrackResults } from "@/lib/track-results";

type StationDisplayInput = {
  status?: string | null;
  track_results?: unknown;
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
    label: "접수대기",
    tone: "bauhaus-status-chip--waiting",
    isComplete: false,
    needsAttention: false,
  },
  WAITING_RESULT: {
    key: "WAITING_RESULT",
    label: "결과대기",
    tone: "bauhaus-status-chip--info",
    isComplete: false,
    needsAttention: false,
  },
  IN_REVIEW: {
    key: "IN_REVIEW",
    label: "심의중",
    tone: "bg-violet-600 text-white dark:bg-violet-300 dark:text-[#06111f]",
    isComplete: false,
    needsAttention: false,
  },
  NEEDS_FIX: {
    key: "NEEDS_FIX",
    label: "보완요청",
    tone: "bg-orange-500 text-white dark:bg-orange-300 dark:text-[#06111f]",
    isComplete: true,
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
  options: { showPartialTrackBreakdown?: boolean } = {},
) {
  const summary = summarizeTrackResults(review.track_results);
  const rawStatus = (review.status ?? "").toUpperCase();
  const normalizedStatus = normalizeStationReviewStatus(review.status);

  const base = (() => {
    if (normalizedStatus === "NEEDS_FIX") {
      return statusMap.NEEDS_FIX;
    }
    if (summary.outcome === "REJECTED" || normalizedStatus === "REJECTED") {
      return statusMap.REJECTED;
    }
    if (summary.outcome === "PARTIAL") {
      return statusMap.PARTIAL;
    }
    if (summary.outcome === "APPROVED" || normalizedStatus === "APPROVED") {
      return statusMap.APPROVED;
    }
    if (rawStatus === "IN_PROGRESS" || rawStatus === "REVIEWING") {
      return statusMap.IN_REVIEW;
    }
    if (rawStatus === "SENT" || rawStatus === "RECEIVED" || normalizedStatus === "SENT") {
      return statusMap.WAITING_RESULT;
    }
    return statusMap.WAITING_SUBMISSION;
  })();

  const summaryText =
    summary.outcome === "PARTIAL" && options.showPartialTrackBreakdown
      ? buildStationTrackSummaryText(summary.counts, " / ")
      : null;

  return {
    ...base,
    summary,
    summaryText,
  };
}
