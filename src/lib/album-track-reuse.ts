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

export type ApplyAlbumTrackReusableCreditsOptions = {
  fields?: readonly AlbumTrackReusableCreditField[];
  skipIndexes?: readonly number[];
};

/**
 * Fills reusable credit fields that are still blank without replacing any
 * per-track values. This is intentionally safe for compilation albums: an
 * existing performer (or any other existing credit) is always preserved.
 */
export const applyAlbumTrackReusableCreditsToBlankTracks = <
  TTrack extends AlbumTrackReusableCredits,
>(
  tracks: readonly TTrack[],
  source: AlbumTrackReusableCreditSource,
  options: ApplyAlbumTrackReusableCreditsOptions = {},
): TTrack[] => {
  const reusableCredits = getNonBlankReusableCredits(source);
  const fields = options.fields ?? ALBUM_TRACK_REUSABLE_CREDIT_FIELDS;
  const skipIndexes = new Set(options.skipIndexes ?? []);

  return tracks.map((track, index) => {
    if (skipIndexes.has(index)) return track;

    const additions: Partial<AlbumTrackReusableCredits> = {};
    for (const field of fields) {
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

  return applyAlbumTrackReusableCreditsToBlankTracks(tracks, sourceTrack, {
    skipIndexes: [sourceIndex],
  });
};
