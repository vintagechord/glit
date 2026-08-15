export const ALBUM_TRACK_REUSABLE_CREDIT_FIELDS = [
  "performer",
  "composer",
  "lyricist",
  "arranger",
] as const;

export type AlbumTrackReusableCreditField =
  (typeof ALBUM_TRACK_REUSABLE_CREDIT_FIELDS)[number];

export type AlbumTrackReusableCredits = Record<
  AlbumTrackReusableCreditField,
  string
>;

export type AlbumTrackReusableCreditSource = Partial<
  Record<AlbumTrackReusableCreditField, string | null | undefined>
>;

const getNonBlankReusableCredits = (
  source: AlbumTrackReusableCreditSource,
) => {
  const credits: Partial<AlbumTrackReusableCredits> = {};

  for (const field of ALBUM_TRACK_REUSABLE_CREDIT_FIELDS) {
    const value = source[field]?.trim() ?? "";
    if (value) {
      credits[field] = value;
    }
  }

  return credits;
};

/**
 * Builds a fresh track from an initial-track template and copies only reusable
 * performer/credit values. Track-specific fields always come from the template.
 */
export const createAlbumTrackWithReusableCredits = <
  TTrack extends AlbumTrackReusableCredits,
>(
  initialTrack: TTrack,
  sourceTrack: AlbumTrackReusableCreditSource,
): TTrack =>
  ({
    ...initialTrack,
    ...getNonBlankReusableCredits(sourceTrack),
  }) as TTrack;

/**
 * Applies the selected source track's nonblank reusable values to blank fields
 * in other tracks. Existing per-track overrides and the source track are kept.
 */
export const applyAlbumTrackCreditsToBlankTracks = <
  TTrack extends AlbumTrackReusableCredits,
>(
  tracks: readonly TTrack[],
  sourceIndex: number,
): TTrack[] => {
  const sourceTrack = tracks[sourceIndex];
  if (!sourceTrack || !Number.isInteger(sourceIndex)) {
    return [...tracks];
  }

  const reusableCredits = getNonBlankReusableCredits(sourceTrack);

  return tracks.map((track, index) => {
    if (index === sourceIndex) return track;

    const additions: Partial<AlbumTrackReusableCredits> = {};
    for (const field of ALBUM_TRACK_REUSABLE_CREDIT_FIELDS) {
      const reusableValue = reusableCredits[field];
      if (!track[field].trim() && reusableValue) {
        additions[field] = reusableValue;
      }
    }

    return Object.keys(additions).length > 0
      ? ({ ...track, ...additions } as TTrack)
      : track;
  });
};
