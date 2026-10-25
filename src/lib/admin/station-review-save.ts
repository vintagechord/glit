import type { SupabaseClient } from "@supabase/supabase-js";
import type { StationReviewStatus } from "@/constants/review-status";
import { areTrackResultsEquivalent, normalizeTrackResults, summarizeTrackResults } from "@/lib/track-results";

export type SavedStationReview = {
  id: string;
  submission_id: string;
  station_id: string;
  status: string;
  result_note: string | null;
  track_results?: unknown;
  updated_at: string;
};

export function resolveStationStatusForSave(status: StationReviewStatus, tracks: unknown): StationReviewStatus {
  if (status === "NEEDS_FIX") return status;
  const summary = summarizeTrackResults(tracks);
  if (!summary.counts.total) return status;
  if (summary.counts.pending > 0) {
    // A progress-only save must keep the administrator's actual workflow step.
    if (!summary.counts.approved && !summary.counts.rejected && !["APPROVED", "REJECTED"].includes(status)) return status;
    return "SENT";
  }
  if (summary.outcome === "APPROVED" || summary.outcome === "REJECTED") return summary.outcome;
  if (summary.outcome === "PARTIAL") return "APPROVED";
  if (summary.counts.approved || summary.counts.rejected) return "SENT";
  return status;
}

const missingColumn = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42703" || error.code === "PGRST204") && /track_results/.test(error.message ?? ""));

/** Each attempt saves the status, note and track decisions in one SQL write. */
export async function saveStationReview(client: SupabaseClient, input: {
  reviewId?: string;
  submissionId: string;
  stationId: string;
  status: StationReviewStatus;
  resultNote?: string;
  trackResults?: unknown;
}): Promise<{ row?: SavedStationReview; error?: string; warning?: string }> {
  const tracks = input.trackResults === undefined ? undefined : normalizeTrackResults(input.trackResults);
  const status = resolveStationStatusForSave(input.status, tracks);
  const base = {
    submission_id: input.submissionId,
    station_id: input.stationId,
    status,
    result_note: input.resultNote?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const variants = tracks === undefined ? [[]] : [
    ["track_results_json", "track_results"],
    ["track_results_json"],
    ["track_results"],
  ];
  for (const columns of variants) {
    const payload: Record<string, unknown> = { ...base };
    for (const column of columns) payload[column] = tracks;
    const trackSelect = columns.length ? `, track_results:${columns[0]}` : "";
    const select = `id, submission_id, station_id, status, result_note, updated_at${trackSelect}`;
    let query = client.from("station_reviews").update(payload)
      .eq("submission_id", input.submissionId).eq("station_id", input.stationId);
    if (input.reviewId) query = query.eq("id", input.reviewId);
    let { data, error } = await query.select(select);
    if (!error && !data?.length && !input.reviewId) {
      ({ data, error } = await client.from("station_reviews").insert(payload).select(select));
    }
    if (missingColumn(error)) continue;
    if (error) return { error: "심의 결과를 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };
    const row = data?.[0] as SavedStationReview | undefined;
    if (!row || row.status !== status || (tracks !== undefined && !areTrackResultsEquivalent(row.track_results, tracks))) {
      return { error: "심의 결과 저장을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 확인해주세요." };
    }
    return {
      row,
      ...(columns[0] === "track_results" ? { warning: "이전 심의 결과 저장 형식을 사용 중입니다." } : {}),
    };
  }
  return { error: "트랙별 결과 저장 항목이 준비되지 않아 저장하지 않았습니다. 관리자에게 DB 업데이트를 요청해주세요." };
}
