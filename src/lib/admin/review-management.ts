import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getStationReviewTracks, isWbsReview, normalizeTrackResults, resolveStationTrackResults } from "../track-results";
import { resolveStationStatusForSave, type SavedStationReview } from "./station-review-save";
import { broadcastRatingValues } from "../broadcast-rating";
export { broadcastRatingLabels, broadcastRatingValues } from "../broadcast-rating";

export const stationManagementSchema = z.object({
  actorUserId: z.string().uuid(), submissionId: z.string().uuid(), stationId: z.string().uuid(),
  reviewId: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(["NOT_SENT", "SENT", "RECEIVED", "APPROVED", "REJECTED", "NEEDS_FIX"]),
  resultNote: z.string().max(4000).optional(),
  ageRating: z.enum(broadcastRatingValues).nullable().optional(),
  trackResults: z.array(z.object({
    trackId: z.string().uuid().optional(), trackNo: z.number().int().positive().optional(),
    title: z.string().max(1000).optional(), status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  })).max(999).optional(),
});
export type ManagedStationReviewInput = z.infer<typeof stationManagementSchema>;
export type ManagedReviewResult = {
  ok: boolean; changed?: boolean; row?: SavedStationReview & { age_rating?: string | null };
  changeKey?: string; stationName?: string; submissionStatus?: string; resultStatus?: string | null;
  error?: string; errorCode?: string;
};

const failure = (errorCode: string, error: string): ManagedReviewResult => ({ ok: false, errorCode, error });
export function reviewManagementError(error: { message?: string | null; code?: string } | null): ManagedReviewResult {
  const message = error?.message ?? "";
  if (message.includes("REVIEW_CONFLICT")) return failure("CONFLICT", "다른 화면에서 이 심의 정보가 변경되었습니다. 최신 내용을 다시 불러온 뒤 저장해주세요.");
  if (message.includes("REVIEW_FORBIDDEN")) return failure("FORBIDDEN", "심의 결과를 저장할 관리자 권한이 없습니다.");
  if (message.includes("REVIEW_STATION_NOT_REQUESTED")) return failure("NOT_REQUESTED", "이 신청에 포함된 방송사만 수정할 수 있습니다.");
  if (message.includes("REVIEW_BROADCAST_PER_STATION_REQUIRED")) return failure("PER_STATION_REQUIRED", "방송용 MV는 신청 방송사별로 등급과 결과를 입력해주세요.");
  if (message.includes("REVIEW_RATING_REQUIRED")) return failure("RATING_REQUIRED", "방송용 MV 적격 결과에는 해당 방송사의 연령 등급을 선택해주세요.");
  if (/REVIEW_(?:TRACK|RATING|MEMO|TYPE|STATUS|RESULT)_INVALID/.test(message)) return failure("INVALID", "심의 결과·등급·트랙 입력을 확인해주세요.");
  if (["42883", "PGRST202"].includes(error?.code ?? "")) return failure("UPGRADE_REQUIRED", "심의 연동 업데이트가 아직 적용되지 않았습니다. 서비스 업데이트 후 다시 시도해주세요.");
  return failure("SAVE_FAILED", "심의 결과를 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.");
}

/** Shared by the authenticated web administrator and the Mac desktop bridge.
 * Validation happens before the single transaction. Publication/email are deliberately
 * outside this function: the caller queues the shared notification only when changed.
 */
export async function saveManagedStationReview(client: SupabaseClient, input: ManagedStationReviewInput): Promise<ManagedReviewResult> {
  const parsed = stationManagementSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "심의 입력값과 최신 변경 시각을 확인해주세요.");
  const value = parsed.data;
  const [submissionResult, reviewResult, stationResult, tracksResult] = await Promise.all([
    client.from("submissions").select("id,type").eq("id", value.submissionId).maybeSingle(),
    client.from("station_reviews").select("*").eq("submission_id", value.submissionId).eq("station_id", value.stationId).maybeSingle(),
    client.from("stations").select("id,code,name").eq("id", value.stationId).maybeSingle(),
    client.from("album_tracks").select("id,track_no,track_title,track_title_kr,track_title_en,broadcast_selected").eq("submission_id", value.submissionId),
  ]);
  if (submissionResult.error || reviewResult.error || stationResult.error || tracksResult.error || !submissionResult.data || !stationResult.data) return failure("LOAD_FAILED", "저장 전 신청·방송사·트랙 정보를 확인하지 못했습니다.");
  const type = submissionResult.data.type;
  if (!["ALBUM", "MV_BROADCAST"].includes(type)) return failure("INVALID_TYPE", "온라인 MV는 영등위 결과 입력에서 저장해주세요.");
  const previous = reviewResult.data;
  if ((value.reviewId && previous?.id !== value.reviewId) || (previous?.updated_at ?? null) !== value.expectedUpdatedAt) return reviewManagementError({ message: "REVIEW_CONFLICT" });
  let ageRating: string | null = null;
  let status = value.status;
  let tracks: unknown[] = [];
  if (type === "MV_BROADCAST") {
    if (value.trackResults?.length) return failure("INVALID", "방송용 MV에는 음반 트랙별 결과를 저장할 수 없습니다.");
    ageRating = value.status === "APPROVED" ? (value.ageRating === undefined ? previous?.age_rating ?? null : value.ageRating) : null;
    if (value.status === "APPROVED" && !ageRating) return reviewManagementError({ message: "REVIEW_RATING_REQUIRED" });
  } else {
    if (value.ageRating) return failure("INVALID", "음반 심의에는 영상 연령 등급을 저장할 수 없습니다.");
    const raw = value.trackResults === undefined && previous?.status === value.status
      ? previous.track_results_json ?? previous.track_results
      : value.trackResults;
    const normalized = normalizeTrackResults(raw);
    const allTracks = tracksResult.data ?? [];
    const targets = getStationReviewTracks(allTracks, stationResult.data, raw);
    const seen = new Set<string>();
    for (const track of normalized) {
      const matched = targets.find(row => track.track_id ? row.id === track.track_id : track.track_no === row.track_no);
      if (!matched && track.status === "PENDING" && isWbsReview(stationResult.data) &&
          allTracks.some(row => track.track_id ? row.id === track.track_id && (track.track_no == null || row.track_no === track.track_no) : row.track_no === track.track_no)) continue;
      if (!matched || seen.has(matched.id) || (track.track_no != null && track.track_no !== matched.track_no)) return failure("INVALID_TRACK", "트랙 결과가 신청된 곡 목록과 일치하지 않습니다.");
      seen.add(matched.id);
    }
    if (isWbsReview(stationResult.data) && normalized.filter(track => track.status !== "PENDING").length > 3) return failure("INVALID_TRACK", "WBS 심의 결과는 실제 신청한 최대 3곡에만 입력해주세요.");
    if (isWbsReview(stationResult.data) && targets.length > 3 && !normalized.some(track => track.status !== "PENDING") && ["APPROVED", "REJECTED"].includes(status)) return failure("INVALID_TRACK", "WBS 심의 대상 3곡을 확인한 뒤 트랙별 결과를 입력해주세요.");
    tracks = resolveStationTrackResults(raw, allTracks, status, stationResult.data);
    status = resolveStationStatusForSave(status, tracks);
  }
  const { data, error } = await client.rpc("save_station_review_result", {
    p_submission_id: value.submissionId, p_station_id: value.stationId, p_actor_user_id: value.actorUserId,
    p_expected_updated_at: value.expectedUpdatedAt, p_status: status,
    p_result_note: value.resultNote === undefined ? previous?.result_note ?? null : value.resultNote.trim() || null,
    p_track_results: tracks, p_age_rating: ageRating,
  });
  if (error || !data?.completed || !data.row) return reviewManagementError(error);
  return { ok: true, changed: data.changed === true, stationName: stationResult.data.name ?? stationResult.data.code, row: { ...data.row, track_results: data.row.track_results_json }, changeKey: data.changeKey, submissionStatus: data.submissionStatus, resultStatus: data.resultStatus };
}

export async function saveManagedOnlineReview(client: SupabaseClient, input: {
  actorUserId: string; submissionId: string; expectedUpdatedAt: string;
  rating: string; resultMemo?: string;
}): Promise<ManagedReviewResult> {
  const parsed = z.object({ actorUserId: z.string().uuid(), submissionId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), rating: z.enum(["ALL", "12", "15", "18", "19", "REJECT"]), resultMemo: z.string().max(4000).optional() }).safeParse(input);
  if (!parsed.success) return failure("INVALID", "영등위 등급과 최신 변경 시각을 확인해주세요.");
  const value = parsed.data;
  const { data, error } = await client.rpc("save_online_review_result", {
    p_submission_id: value.submissionId, p_actor_user_id: value.actorUserId,
    p_expected_updated_at: value.expectedUpdatedAt, p_rating: value.rating === "18" ? "19" : value.rating,
    p_result_memo: value.resultMemo ?? null, p_set_result_memo: value.resultMemo !== undefined,
  });
  if (error || !data?.completed) return reviewManagementError(error);
  return { ok: true, changed: data.changed === true, changeKey: data.changeKey, submissionStatus: "RESULT_READY", resultStatus: data.resultStatus };
}
