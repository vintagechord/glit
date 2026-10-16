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
  broadcast_selected?: boolean | null;
};

export type ReviewStation = { code?: string | null; name?: string | null } | null;

export const isWbsReview = (station?: ReviewStation) =>
  station?.code?.trim().toUpperCase() === "WBS" || /원음/.test(station?.name ?? "");

export function getStationReviewTracks<T extends AlbumTrackMeta>(
  albumTracks: T[],
  station?: ReviewStation,
  rawTrackResults?: unknown,
): T[] {
  if (!isWbsReview(station) || albumTracks.length < 4) return albumTracks;
  const selected = albumTracks.filter((track) => track.broadcast_selected === true);
  if (selected.length > 0 && selected.length <= 3) return selected;
  // An old album without a saved selection can only identify its WBS targets
  // from three distinct, final decisions tied to the current album's track IDs.
  const finalIds = new Set(normalizeTrackResults(rawTrackResults)
    .filter((result) => result.track_id && (result.status === "APPROVED" || result.status === "REJECTED"))
    .map((result) => result.track_id));
  const decided = albumTracks.filter((track) => track.id && finalIds.has(track.id));
  return decided.length === 3 ? decided : albumTracks;
}

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
  const normalized = (value ?? "").trim().toUpperCase();
  if (allowedStatuses.has(normalized as TrackReviewStatus)) {
    return normalized as TrackReviewStatus;
  }
  return "PENDING";
};

export function normalizeTrackResults(
  raw: unknown,
  albumTracks?: AlbumTrackMeta[] | null,
): TrackReviewResult[] {
  const items = (() => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  })();
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
      typeof maybeTrack.track_id === "string"
        ? maybeTrack.track_id
        : typeof maybeTrack.trackId === "string"
          ? maybeTrack.trackId
          : null;
    const trackNoRaw =
      typeof maybeTrack.track_no === "number"
        ? maybeTrack.track_no
        : typeof maybeTrack.trackNo === "number"
          ? maybeTrack.trackNo
          : null;
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

/** Complete the track list before deciding whether a station has finished review. */
export function resolveStationTrackResults(
  raw: unknown,
  albumTracks?: AlbumTrackMeta[] | null,
  stationStatus?: string | null,
  station?: ReviewStation,
): TrackReviewResult[] {
  const normalized = normalizeTrackResults(raw, albumTracks);
  const reviewTracks = getStationReviewTracks(albumTracks ?? [], station, raw);
  // Older reviews only stored a station-level decision. Inherit it only when
  // there are no per-track decisions; otherwise unreviewed tracks stay pending.
  const hasDecisions = normalized.some((track) => track.status !== "PENDING");
  const overall = toTrackStatus(stationStatus);
  const unknownWbsTargets = isWbsReview(station) && reviewTracks.length > 3;
  const invalidWbsDecisions = unknownWbsTargets && normalized.filter((track) => track.status !== "PENDING").length > 3;
  const inheritedStatus = !hasDecisions && !unknownWbsTargets ? overall : "PENDING";
  if (!albumTracks?.length) {
    return normalized.map((track) => ({
      ...track,
      status: hasDecisions ? track.status : inheritedStatus,
    }));
  }
  return reviewTracks.map((track, index) => {
    const matched = normalized.find((result) =>
      result.track_id && track.id
        ? result.track_id === track.id
        : typeof result.track_no === "number" && result.track_no === track.track_no,
    );
    return {
      track_id: track.id ?? matched?.track_id ?? null,
      track_no: track.track_no ?? matched?.track_no ?? index + 1,
      title: pickTrackTitle(track) ?? matched?.title ?? "트랙",
      status: invalidWbsDecisions ? "PENDING" : hasDecisions ? matched?.status ?? "PENDING" : inheritedStatus,
    };
  });
}

const buildComparableTrackResults = (
  raw: unknown,
  albumTracks?: AlbumTrackMeta[] | null,
) => {
  const normalized = normalizeTrackResults(raw, albumTracks);
  const comparable = normalized.map((item, index) => {
    const trackId = item.track_id ?? null;
    const trackNo =
      typeof item.track_no === "number" && Number.isFinite(item.track_no)
        ? item.track_no
        : null;
    const key = trackId
      ? `id:${trackId}`
      : trackNo !== null
        ? `no:${trackNo}`
        : `idx:${index}`;
    return {
      track_id: trackId,
      track_no: trackNo,
      status: toTrackStatus(typeof item.status === "string" ? item.status : null),
      _key: key,
      _index: index,
    };
  });

  comparable.sort((a, b) => {
    if (a._key < b._key) return -1;
    if (a._key > b._key) return 1;
    return a._index - b._index;
  });

  return comparable.map((item) => ({
    track_id: item.track_id,
    track_no: item.track_no,
    status: item.status,
  }));
};

export function areTrackResultsEquivalent(
  left: unknown,
  right: unknown,
  albumTracks?: AlbumTrackMeta[] | null,
): boolean {
  const normalizedLeft = buildComparableTrackResults(left, albumTracks);
  const normalizedRight = buildComparableTrackResults(right, albumTracks);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
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
    if (counts.pending > 0) {
      outcome = "PENDING";
    } else if (counts.approved === counts.total) {
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
