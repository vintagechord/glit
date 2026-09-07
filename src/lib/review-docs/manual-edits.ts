import type { ReviewDocumentData } from "./model";

/** Server-side comparison preserves deliberate blank edits across re-analysis. */
export function recordManualReviewEdits(draft: ReviewDocumentData, previous: ReviewDocumentData): ReviewDocumentData {
  const previousTracks = new Map(previous.albums.flatMap((a) => a.tracks.map((t) => [t.id, t] as const)));
  const scalarChanges = (next: object, before?: object) => Object.entries(next).flatMap(([key, value]) => {
    if (!["string", "number", "boolean"].includes(typeof value) || key === "id") return [];
    return !before || (before as Record<string, unknown>)[key] !== value ? [key] : [];
  });
  return { ...draft, albums: draft.albums.map((album) => ({
    ...album,
    reviewedFields: [...new Set([...album.reviewedFields, ...scalarChanges(album, previous.albums.find((a) => a.id === album.id))])],
    tracks: album.tracks.map((track) => ({ ...track,
      reviewedFields: [...new Set([...track.reviewedFields, ...scalarChanges(track, previousTracks.get(track.id))])],
    })),
  })) };
}
