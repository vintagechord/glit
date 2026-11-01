export type ArchiveReviewContext = { libraryId: string; releaseId: string; trackId?: string };
export type ArchiveReviewEntry = {
  context: ArchiveReviewContext;
  title: string;
  artistName: string;
  releaseDate?: string;
  albumUrl: string;
  tracks: Array<{ id: string; title: string; artistName: string; discNumber: number; trackNumber: number }>;
};

export function buildArchiveReviewEntryHref({ libraryId, releaseId, trackId, localePrefix = "" }: ArchiveReviewContext & { localePrefix?: string }) {
  const query = new URLSearchParams({ archiveLibrary: libraryId, archiveRelease: releaseId });
  if (trackId) query.set("archiveTrack", trackId);
  // Its own server route: the regular album application page is static.
  return `${localePrefix === "/en" ? "/en" : ""}/dashboard/new/album/archive?${query}`;
}
