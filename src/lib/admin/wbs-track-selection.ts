import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { isWbsReview, normalizeTrackResults } from "@/lib/track-results";

/**
 * 원음방송(WBS) reviews at most three songs per album. For albums of four or
 * more songs the three are the tracks marked broadcast_selected; every other
 * station and the application keep all tracks. Without a mark the WBS row
 * shows every song and asks the operator to pick.
 */
export const WBS_MAX_TRACKS = 3;

const selectionSchema = z.object({
  submissionId: z.string().uuid(),
  trackIds: z.array(z.string().uuid()).min(1).max(WBS_MAX_TRACKS),
});

export type WbsSelectionResult =
  | { ok: true; changed: boolean; selected: number }
  | { ok: false; error: string };

type TrackRow = { id: string; track_no: number | null; track_title: string | null; broadcast_selected: boolean | null };

export async function saveWbsTrackSelection(
  db: SupabaseClient,
  input: { submissionId: string; trackIds: string[]; actorUserId: string },
): Promise<WbsSelectionResult> {
  const parsed = selectionSchema.safeParse({ submissionId: input.submissionId, trackIds: [...new Set(input.trackIds)] });
  if (!parsed.success) return { ok: false, error: `원음방송 심의곡을 1곡 이상 ${WBS_MAX_TRACKS}곡 이하로 선택해주세요.` };
  const { submissionId, trackIds } = parsed.data;

  const [submissionResult, tracksResult, reviewsResult] = await Promise.all([
    db.from("submissions").select("id, type").eq("id", submissionId).maybeSingle(),
    db.from("album_tracks").select("id, track_no, track_title, broadcast_selected").eq("submission_id", submissionId).order("track_no"),
    db.from("station_reviews").select("track_results_json, track_results, station:stations ( code, name )").eq("submission_id", submissionId),
  ]);
  if (submissionResult.error || tracksResult.error || reviewsResult.error) return { ok: false, error: "앨범 트랙 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
  if (!submissionResult.data || submissionResult.data.type !== "ALBUM") return { ok: false, error: "음반 심의 접수에서만 원음방송 심의곡을 지정할 수 있습니다." };

  const tracks = (tracksResult.data ?? []) as TrackRow[];
  if (tracks.length <= WBS_MAX_TRACKS) return { ok: false, error: "3곡 이하 앨범은 모든 곡이 원음방송 심의 대상이라 따로 지정하지 않습니다." };
  const known = new Set(tracks.map((track) => track.id));
  if (trackIds.some((id) => !known.has(id))) return { ok: false, error: "이 앨범에 없는 트랙이 포함되어 있습니다. 새로고침 후 다시 선택해주세요." };

  type ReviewRow = { track_results_json?: unknown; track_results?: unknown; station?: { code?: string | null; name?: string | null } | Array<{ code?: string | null; name?: string | null }> | null };
  const wbsReview = ((reviewsResult.data ?? []) as ReviewRow[]).find((review) => {
    const station = Array.isArray(review.station) ? review.station[0] : review.station;
    return isWbsReview(station ?? null);
  });
  if (!wbsReview) return { ok: false, error: "이 접수에는 원음방송 심의가 없습니다." };

  // A song with a saved WBS result cannot silently drop out of the review.
  const selected = new Set(trackIds);
  const decided = normalizeTrackResults(wbsReview.track_results_json ?? wbsReview.track_results)
    .filter((result) => result.status === "APPROVED" || result.status === "REJECTED");
  const decidedOutside = decided.filter((result) => {
    const track = tracks.find((row) => (result.track_id ? row.id === result.track_id : row.track_no === result.track_no));
    return track && !selected.has(track.id);
  });
  if (decidedOutside.length) {
    return { ok: false, error: "원음방송 결과(적격·부적격)가 저장된 곡은 제외할 수 없습니다. 해당 곡 결과를 대기로 바꾼 뒤 다시 지정해주세요." };
  }

  const unchanged = tracks.every((track) => (track.broadcast_selected === true) === selected.has(track.id));
  if (unchanged) return { ok: true, changed: false, selected: trackIds.length };

  const toClear = tracks.filter((track) => track.broadcast_selected === true && !selected.has(track.id)).map((track) => track.id);
  const toSet = tracks.filter((track) => track.broadcast_selected !== true && selected.has(track.id)).map((track) => track.id);
  if (toClear.length) {
    const { error } = await db.from("album_tracks").update({ broadcast_selected: false }).eq("submission_id", submissionId).in("id", toClear);
    if (error) return { ok: false, error: "원음방송 심의곡을 저장하지 못했습니다. 다시 시도해주세요." };
  }
  if (toSet.length) {
    const { error } = await db.from("album_tracks").update({ broadcast_selected: true }).eq("submission_id", submissionId).in("id", toSet);
    if (error) return { ok: false, error: "원음방송 심의곡을 저장하지 못했습니다. 다시 시도해주세요." };
  }

  const titles = tracks.filter((track) => selected.has(track.id)).map((track) => `${track.track_no ?? "-"}. ${track.track_title ?? "트랙"}`);
  await db.from("submission_events").insert({
    submission_id: submissionId,
    actor_user_id: input.actorUserId,
    event_type: "ADMIN_STATUS",
    message: `원음방송 심의곡을 ${titles.length}곡으로 지정했습니다: ${titles.join(", ")}`,
  });
  return { ok: true, changed: true, selected: trackIds.length };
}
