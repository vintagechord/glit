import { reviewAlbumSchema, reviewTrackSchema, type ReviewDocumentData, type ReviewAlbum, type ReviewTrack, foreignLyricSpans } from "@/lib/review-docs/model";

export const emptyAlbum = (id: string): ReviewAlbum => reviewAlbumSchema.parse({ id, tracks: [] });
export const emptyTrack = (id: string, number: number): ReviewTrack => reviewTrackSchema.parse({ id, number });
const renumber = (tracks: ReviewTrack[]) => tracks.map((track, index) => ({ ...track, number: index + 1 }));

export function reorderReviewTrack(data: ReviewDocumentData, albumId: string, trackId: string, delta: number): ReviewDocumentData {
  return { ...data, albums: data.albums.map((album) => {
    if (album.id !== albumId) return album;
    const index = album.tracks.findIndex((track) => track.id === trackId);
    if (index < 0 || index + delta < 0 || index + delta >= album.tracks.length) return album;
    const tracks = [...album.tracks];
    const [track] = tracks.splice(index, 1);
    tracks.splice(index + delta, 0, track);
    return { ...album, tracks: renumber(tracks) };
  }) };
}

export function moveReviewTrack(data: ReviewDocumentData, sourceId: string, trackId: string, destinationId: string): ReviewDocumentData {
  if (sourceId === destinationId) return data;
  const source = data.albums.find((album) => album.id === sourceId);
  const target = data.albums.find((album) => album.id === destinationId);
  const track = source?.tracks.find((item) => item.id === trackId);
  if (!source || !target || !track) return data;
  return { ...data, albums: data.albums.map((album) => album.id === sourceId
    ? { ...album, tracks: renumber(album.tracks.filter((item) => item.id !== trackId)), wbsTrackIds: album.wbsTrackIds.filter((id) => id !== trackId) }
    : album.id === destinationId
      ? { ...album, sourceIds: [...new Set([...album.sourceIds, ...track.sourceIds])], tracks: renumber([...album.tracks, track]) }
      : album) };
}

/** A deliberate merge retains every track and records conflicting metadata. */
export function mergeReviewAlbums(data: ReviewDocumentData, sourceId: string, destinationId: string): ReviewDocumentData {
  if (sourceId === destinationId) return data;
  const source = data.albums.find((album) => album.id === sourceId);
  const target = data.albums.find((album) => album.id === destinationId);
  if (!source || !target) return data;
  const merged: ReviewAlbum = { ...target, tracks: renumber([...target.tracks, ...source.tracks]), sourceIds: [...new Set([...target.sourceIds, ...source.sourceIds])], evidence: [...target.evidence, ...source.evidence] };
  const issues = [...data.issues];
  for (const field of ["artistName", "artistNameEn", "title", "company", "distributor", "releaseDate", "productionDate", "genre", "albumType", "actType", "members", "previousReleases"] as const) {
    if (!merged[field]) merged[field] = source[field];
    else if (source[field] && merged[field] !== source[field]) issues.push({ id: `merge:${sourceId}:${destinationId}:${field}`, code: "MERGE_CONFLICT", severity: "error", albumId: target.id, field, message: `합친 자료의 ${field} 값이 다릅니다. 유지 값: ${merged[field]} / 다른 원문: ${source[field]}` });
  }
  return { ...data, issues, albums: data.albums.filter((album) => album.id !== sourceId).map((album) => album.id === target.id ? merged : album) };
}

export function alignTranslationSegments(track: ReviewTrack): ReviewTrack {
  return { ...track, translationSegments: foreignLyricSpans(track.lyrics).map((span, index) => {
    const previous = track.translationSegments.find((segment) => segment.start === span.start && segment.end === span.end && segment.source === span.source);
    return previous ?? { ...span, id: `${track.id}:translation:${index}`, translation: "", origin: "provider" as const, confirmed: false };
  }) };
}
