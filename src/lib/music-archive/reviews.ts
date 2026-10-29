import { normalizeTrackResults } from "@/lib/track-results";
import type { ArchiveData } from "./model";
import { parseMusicProviderUrl } from "./providers";
import { groupArchiveAlbums } from "./album-groups";
import { getStationReviewDisplayStatus } from "@/lib/station-review-display";
import type { AlbumTrackMeta } from "@/lib/track-results";

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

export const submissionArchiveColumns = "id,title,artist_name,release_date,status,created_at,updated_at,album_tracks(id,track_no,track_title,track_title_kr,track_title_en,broadcast_selected,composer,lyricist,featuring),station_reviews(id,station_id,status,result_note,age_rating,track_results_json,updated_at,station:stations(name,code)),submission_events(id,event_type,message,created_at)";

/** Read current broadcaster decisions without copying them into manual records. */
export function archiveReviewProgress(submission: {
  status: string;
  album_tracks?: AlbumTrackMeta[];
  station_reviews?: { status?: string | null; track_results_json?: unknown; station?: { name?: string; code?: string } | { name?: string; code?: string }[] | null }[];
}) {
  const stations = submission.station_reviews ?? [];
  if (stations.length) {
    const complete = stations.every(review => getStationReviewDisplayStatus({
      status: review.status, track_results: review.track_results_json,
      station: Array.isArray(review.station) ? review.station[0] : review.station,
    }, { albumTracks: submission.album_tracks }).isComplete);
    if (complete) return "COMPLETED";
    if (["RESULT_READY", "COMPLETED", "APPROVED", "REJECTED"].includes(submission.status)) return "IN_PROGRESS";
  } else if (submission.status === "RESULT_READY") return "COMPLETED";
  return submission.status;
}

export function normalizeSubmissionTitles<T extends { album_tracks?: { track_title?: string | null; track_title_kr?: string | null; track_title_en?: string | null }[] }>(submission: T) {
  return { ...submission, album_tracks: submission.album_tracks?.map(track => ({ ...track, track_title: track.track_title || track.track_title_kr || track.track_title_en || "제목 정보 없음" })) ?? [] };
}

export type OnsideArchiveReview = { submissionId: string; releaseId: string; trackIds: string[]; status: string };

/** Find the exact track scope still needing an application, including partial albums. */
export function unreviewedArchiveTracks(data: ArchiveData, releaseId: string, reviews: OnsideArchiveReview[], trackId?: string) {
  const tracks = data.tracks.filter(track => track.releaseId === releaseId && track.managed && !track.excluded && !track.mergedInto && (!trackId || track.id === trackId));
  const covered = new Set<string>();
  for (const review of reviews.filter(review => review.releaseId === releaseId && !["CANCELLED", "DRAFT", "PRE_REVIEW"].includes(review.status))) {
    for (const id of review.trackIds.length ? review.trackIds : tracks.map(track => track.id)) covered.add(id);
  }
  const latest = new Map<string, typeof data.tasks[number]>();
  for (const task of data.tasks.filter(task => task.kind === "review")) latest.set(JSON.stringify([(task as typeof task & { originalTrackId?: string }).originalTrackId ?? task.trackId, task.agency]), task);
  for (const task of latest.values()) {
    if (["completed", "submitted", "processing"].includes(task.status) || ["eligible", "ineligible", "rejected"].includes(task.result)) covered.add(task.trackId);
  }
  return tracks.filter(track => !covered.has(track.id));
}

/** Completed scopes can apply to another station; an active submission takes priority. */
export function additionalStationReviewTracks(data: ArchiveData, releaseId: string, reviews: OnsideArchiveReview[], trackId?: string) {
  const tracks = data.tracks.filter(track => track.releaseId === releaseId && track.managed && !track.excluded && !track.mergedInto && (!trackId || track.id === trackId));
  const completed = new Set<string>(); const ongoing = new Set<string>();
  for (const review of reviews.filter(review => review.releaseId === releaseId && !["CANCELLED", "DRAFT", "PRE_REVIEW"].includes(review.status))) {
    const target = ["COMPLETED", "APPROVED", "REJECTED"].includes(review.status) ? completed : ongoing;
    for (const id of review.trackIds.length ? review.trackIds : tracks.map(track => track.id)) target.add(id);
  }
  const latest = new Map<string, typeof data.tasks[number]>();
  for (const task of data.tasks.filter(task => task.kind === "review")) latest.set(JSON.stringify([(task as typeof task & { originalTrackId?: string }).originalTrackId ?? task.trackId, task.agency]), task);
  for (const task of latest.values()) {
    if (["submitted", "processing"].includes(task.status)) ongoing.add(task.trackId);
    else if (task.status === "completed" || ["eligible", "ineligible", "rejected"].includes(task.result)) completed.add(task.trackId);
  }
  return tracks.filter(track => completed.has(track.id) && !ongoing.has(track.id));
}
type MatchSubmission = { id: string; status: string; melon_url?: string | null; archive_review_context?: unknown; album_tracks?: { track_no?: number; track_title?: string | null; track_title_kr?: string | null; track_title_en?: string | null }[] };

/** Caller must supply only the authenticated owner's undeleted album submissions. */
export function matchArchiveReviews(data: ArchiveData, submissions: MatchSubmission[], libraryId?: string): OnsideArchiveReview[] {
  const matches: OnsideArchiveReview[] = [];
  let albumGroups: ReturnType<typeof groupArchiveAlbums> | undefined;
  let tracksById: Map<string, ArchiveData["tracks"][number]> | undefined;
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
    if (context) {
      // A stored selection is authoritative, even when invalid or empty. It
      // must never fall through to a broader album-URL match.
      if (context.libraryId !== libraryId || !context.releaseId || !Array.isArray(context.trackIds)) continue;
      const group = (albumGroups ??= groupArchiveAlbums(data)).find(item => item.releaseIds.includes(context.releaseId!));
      if (!group) continue;
      tracksById ??= new Map(data.tracks.map(track => [track.id, track]));
      const releaseIds = new Set(group.releaseIds);
      const scopes = new Map<string, Set<string>>();
      for (const id of context.trackIds) {
        const track = typeof id === "string" ? tracksById.get(id) : undefined;
        if (!track || track.excluded || track.mergedInto || !releaseIds.has(track.releaseId)) continue;
        const ids = scopes.get(track.releaseId) ?? new Set<string>();
        ids.add(track.id); scopes.set(track.releaseId, ids);
      }
      // Keep real provider IDs and their original album scope. Display aliases
      // are resolved separately and cannot grant an unselected song a result.
      for (const [releaseId, ids] of scopes) matches.push({ submissionId: submission.id, releaseId, trackIds: [...ids], status: submission.status });
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
