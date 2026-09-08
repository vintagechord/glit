import { normalizeTrackResults } from "@/lib/track-results";

type ReviewRow = { status?: string; track_results_json?: unknown; updated_at?: string };

/** A mapped submission track is the scope. Never inherit album approval or match titles. */
export function linkedTrackResult(review: ReviewRow, submissionTrackId: string) {
  const result = normalizeTrackResults(review.track_results_json).find(row => row.track_id === submissionTrackId);
  return {
    progress: review.status ?? "NOT_SENT",
    result: result?.status === "APPROVED" ? "approved" : result?.status === "REJECTED" ? "rejected" : "unknown",
    source: "onside_internal",
    confirmedAt: review.updated_at ?? null,
  };
}

export const submissionArchiveColumns = "id,title,artist_name,release_date,status,created_at,updated_at,album_tracks(id,track_no,track_title,track_title_kr,track_title_en,composer,lyricist,featuring),station_reviews(id,station_id,status,result_note,track_results_json,updated_at,station:stations(name)),submission_events(id,event_type,message,created_at)";

export function normalizeSubmissionTitles<T extends { album_tracks?: { track_title?: string | null; track_title_kr?: string | null; track_title_en?: string | null }[] }>(submission: T) {
  return { ...submission, album_tracks: submission.album_tracks?.map(track => ({ ...track, track_title: track.track_title || track.track_title_kr || track.track_title_en || "제목 정보 없음" })) ?? [] };
}
