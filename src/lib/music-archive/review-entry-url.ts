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
  return `${localePrefix === "/en" ? "/en" : ""}/dashboard/new/album?${query}`;
}
