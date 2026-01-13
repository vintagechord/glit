export type TrackReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export type TrackReviewResult = {
  track_id?: string | null;
  track_no?: number | null;
  title?: string | null;
  status?: TrackReviewStatus | string | null;
};

export type AlbumTrackMeta = {
  id?: string | null;
  track_no?: number | null;
  track_title?: string | null;
  track_title_kr?: string | null;
  track_title_en?: string | null;
};

const allowedStatuses = new Set<TrackReviewStatus>([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

const pickTrackTitle = (track?: AlbumTrackMeta | null) => {
  if (!track) return null;
  return (
    track.track_title ||
    track.track_title_kr ||
    track.track_title_en ||
    null
  );
};

const toTrackStatus = (value?: string | null): TrackReviewStatus => {
  const normalized = (value ?? "").toUpperCase();
  if (allowedStatuses.has(normalized as TrackReviewStatus)) {
    return normalized as TrackReviewStatus;
  }
  return "PENDING";
};

export function normalizeTrackResults(
  raw: unknown,
  albumTracks?: AlbumTrackMeta[] | null,
): TrackReviewResult[] {
  const items = Array.isArray(raw) ? raw : [];
  type TrackInput =
    | {
        track_id?: string | null;
        trackId?: string | null;
        track_no?: number | null;
        trackNo?: number | null;
        title?: string | null;
        status?: string | null;
        [key: string]: unknown;
      }
    | Record<string, unknown>;
  const trackById = new Map(
    (albumTracks ?? [])
      .filter((track) => track.id)
      .map((track) => [track.id as string, track]),
  );
  const trackByNo = new Map(
    (albumTracks ?? [])
      .filter((track) => typeof track.track_no === "number")
      .map((track) => [track.track_no as number, track]),
  );

  return items.map((item) => {
    const maybeTrack: TrackInput =
      typeof item === "object" && item !== null ? (item as TrackInput) : {};
    const trackId =
      (typeof maybeTrack.track_id === "string" && maybeTrack.track_id) ??
      (typeof maybeTrack.trackId === "string" && maybeTrack.trackId) ??
      null;
    const trackNoRaw =
      (typeof maybeTrack.track_no === "number" && maybeTrack.track_no) ??
      (typeof maybeTrack.trackNo === "number" && maybeTrack.trackNo) ??
      null;
    const trackNo =
      typeof trackNoRaw === "number" && Number.isFinite(trackNoRaw)
        ? trackNoRaw
        : null;
    const matchedTrack =
      (trackId ? trackById.get(trackId) : null) ??
      (trackNo !== null ? trackByNo.get(trackNo) : null) ??
      null;

    return {
      track_id: trackId,
      track_no: trackNo,
      title:
        (typeof maybeTrack.title === "string" ? maybeTrack.title : null) ??
        pickTrackTitle(matchedTrack) ??
        null,
      status: toTrackStatus(
        typeof maybeTrack.status === "string" ? maybeTrack.status : null,
      ),
    };
  });
}

export type TrackOutcome = "APPROVED" | "REJECTED" | "PARTIAL" | "PENDING" | null;

export function summarizeTrackResults(
  raw: unknown,
  albumTracks?: AlbumTrackMeta[] | null,
): {
  results: TrackReviewResult[];
  counts: { total: number; approved: number; rejected: number; pending: number };
  outcome: TrackOutcome;
} {
  const results = normalizeTrackResults(raw, albumTracks);
  const counts = results.reduce(
    (acc, item) => {
      if (item.status === "APPROVED") acc.approved += 1;
      else if (item.status === "REJECTED") acc.rejected += 1;
      else acc.pending += 1;
      acc.total += 1;
      return acc;
    },
    { total: 0, approved: 0, rejected: 0, pending: 0 },
  );

  let outcome: TrackOutcome = null;
  if (counts.total > 0) {
    if (counts.approved === counts.total) {
      outcome = "APPROVED";
    } else if (counts.rejected === counts.total) {
      outcome = "REJECTED";
    } else if (counts.rejected > 0 && counts.approved > 0) {
      outcome = "PARTIAL";
    } else if (counts.pending > 0 || counts.rejected > 0) {
      outcome = "PENDING";
    }
  }

  return { results, counts, outcome };
}
