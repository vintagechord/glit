import { normalizeTrackResults } from "@/lib/track-results";
import type { ArchiveData } from "./model";
import { parseMusicProviderUrl } from "./providers";

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

export type OnsideArchiveReview = { submissionId: string; releaseId: string; trackIds: string[]; status: string };
type MatchSubmission = { id: string; status: string; melon_url?: string | null; archive_review_context?: unknown; album_tracks?: { track_no?: number; track_title?: string | null; track_title_kr?: string | null; track_title_en?: string | null }[] };

/** Caller must supply only the authenticated owner's undeleted album submissions. */
export function matchArchiveReviews(data: ArchiveData, submissions: MatchSubmission[], libraryId?: string): OnsideArchiveReview[] {
  const matches: OnsideArchiveReview[] = [];
  for (const submission of submissions) {
    if (["DRAFT", "PRE_REVIEW", "CANCELLED"].includes(submission.status)) continue;
    const explicit = data.reviewLinks.filter(link => link.submissionId === submission.id);
    if (explicit.length) {
      const scopes = new Map<string, Set<string> | null>();
      for (const link of explicit) {
        const track = link.trackId ? data.tracks.find(item => item.id === link.trackId) : null;
        const releaseId = track?.releaseId ?? link.releaseId;
        if (!releaseId) continue;
        if (!link.trackId) scopes.set(releaseId, null);
        else if (scopes.get(releaseId) !== null) {
          const ids = scopes.get(releaseId) ?? new Set<string>();
          ids.add(link.trackId); scopes.set(releaseId, ids);
        }
      }
      for (const [releaseId, tracks] of scopes) matches.push({ submissionId: submission.id, releaseId, trackIds: tracks ? [...tracks] : [], status: submission.status });
      continue;
    }
    const context = submission.archive_review_context as { libraryId?: string; releaseId?: string; trackIds?: unknown } | null;
    if (context?.libraryId === libraryId && context?.releaseId && Array.isArray(context.trackIds)) {
      const trackIds = context.trackIds.filter((id): id is string => typeof id === "string" && data.tracks.some(track => track.id === id && track.releaseId === context.releaseId));
      if (trackIds.length) matches.push({ submissionId: submission.id, releaseId: context.releaseId, trackIds, status: submission.status });
      continue;
    }
    // An exact public album identity can reconnect old URL applications. Names cannot.
    const identity = submission.melon_url ? parseMusicProviderUrl(submission.melon_url, "release") : null;
    if (!identity) continue;
    const releases = data.releases.filter(release => !release.excluded && !release.mergedInto && release.links.some(link => {
      const candidate = parseMusicProviderUrl(link.url, "release");
      return candidate?.provider === identity.provider && candidate.externalId === identity.externalId;
    }));
    // Ambiguous duplicate albums require an explicit link; never choose the first one.
    if (releases.length !== 1) continue;
    const release = releases[0];
    const submittedTracks = submission.album_tracks ?? [];
    if (!submittedTracks.length) {
      matches.push({ submissionId: submission.id, releaseId: release.id, trackIds: [], status: submission.status });
      continue;
    }
    // Older applications with track rows must keep their selected scope too.
    const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
    const trackIds = submittedTracks.flatMap(row => {
      const title = row.track_title || row.track_title_kr || row.track_title_en;
      const candidates = title ? data.tracks.filter(track => track.releaseId === release.id && !track.excluded && !track.mergedInto && track.trackNumber === row.track_no && normalize(track.title) === normalize(title)) : [];
      return candidates.length === 1 ? [candidates[0].id] : [];
    });
    if (trackIds.length) matches.push({ submissionId: submission.id, releaseId: release.id, trackIds: [...new Set(trackIds)], status: submission.status });
  }
  return matches;
}
