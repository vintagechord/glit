const AUDIO_FILE_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "wav",
  "wave",
  "wma",
]);

export type AlbumTrackMatchTrack = {
  trackTitle: string;
};

export type AlbumTrackMatchFile = {
  name?: string | null;
  originalName?: string | null;
  path?: string | null;
};

export type AlbumTrackFileMatch = {
  trackIndex: number;
  fileIndex: number;
  reason: "normalized-title" | "track-number";
  normalizedName: string;
};

export type AlbumTrackMatchDuplicate = {
  normalizedName: string;
  indexes: number[];
};

export type AlbumTrackFileMatchResult = {
  matches: AlbumTrackFileMatch[];
  missingTrackIndexes: number[];
  unmatchedFileIndexes: number[];
  unsupportedFileIndexes: number[];
  duplicateTrackTitles: AlbumTrackMatchDuplicate[];
  duplicateFileNames: AlbumTrackMatchDuplicate[];
};

const stripQueryAndHash = (value: string) => value.split(/[?#]/, 1)[0] ?? "";

const baseName = (value: string) => {
  const normalized = stripQueryAndHash(value).replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
};

export const getAlbumTrackFileName = (file: AlbumTrackMatchFile) =>
  file.originalName?.trim() ||
  file.name?.trim() ||
  (file.path ? baseName(file.path) : "");

const extensionFor = (fileName: string) => {
  const match = baseName(fileName).match(/\.([^.]+)$/);
  return match?.[1]?.toLocaleLowerCase("en-US") ?? "";
};

export const isAlbumTrackAudioFileName = (fileName: string) =>
  AUDIO_FILE_EXTENSIONS.has(extensionFor(fileName));

const stripAudioExtension = (value: string) => {
  const fileName = baseName(value);
  return isAlbumTrackAudioFileName(fileName)
    ? fileName.replace(/\.[^.]+$/, "")
    : fileName;
};

type NumberedName = {
  name: string;
  trackNumber: number | null;
};

const splitLeadingTrackNumber = (value: string): NumberedName => {
  const bracketed = value.match(
    /^\s*(?:(?:cd|disc)\s*\d+\s*[-_. ]*)?(?:track\s*)?[[(]\s*(\d{1,3})\s*[\])]\s*[-_. ]*/iu,
  );
  if (bracketed) {
    return {
      name: value.slice(bracketed[0].length),
      trackNumber: Number(bracketed[1]),
    };
  }

  const plain = value.match(
    /^\s*(?:(?:cd|disc)\s*\d+\s*[-_. ]*)?(?:track\s*)?(\d{1,3})(?:\s*[-_.]\s*|\s+)/iu,
  );
  if (plain) {
    return {
      name: value.slice(plain[0].length),
      trackNumber: Number(plain[1]),
    };
  }

  return { name: value, trackNumber: null };
};

export const normalizeAlbumTrackMatchName = (value: string) => {
  const withoutExtension = stripAudioExtension(value).normalize("NFKC");
  const { name } = splitLeadingTrackNumber(withoutExtension);

  return name
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
};

const describeName = (value: string) => {
  const withoutExtension = stripAudioExtension(value).normalize("NFKC");
  const numbered = splitLeadingTrackNumber(withoutExtension);
  return {
    normalizedName: normalizeAlbumTrackMatchName(value),
    trackNumber: numbered.trackNumber,
  };
};

const groupDuplicateNames = (
  items: readonly { normalizedName: string; index: number }[],
) => {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    if (!item.normalizedName) continue;
    const indexes = groups.get(item.normalizedName) ?? [];
    indexes.push(item.index);
    groups.set(item.normalizedName, indexes);
  }

  return [...groups.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([normalizedName, indexes]) => ({ normalizedName, indexes }));
};

/**
 * Produces conservative one-to-one matches. Exact normalized titles are used
 * first. A leading track number is only used when the remaining filename is
 * blank or still agrees with that row's normalized title.
 */
export const matchAlbumTracksToAudioFiles = (
  tracks: readonly AlbumTrackMatchTrack[],
  files: readonly AlbumTrackMatchFile[],
): AlbumTrackFileMatchResult => {
  const trackNames = tracks.map((track, index) => ({
    index,
    ...describeName(track.trackTitle),
  }));
  const unsupportedFileIndexes: number[] = [];
  const fileNames = files.flatMap((file, index) => {
    const fileName = getAlbumTrackFileName(file);
    if (!isAlbumTrackAudioFileName(fileName)) {
      unsupportedFileIndexes.push(index);
      return [];
    }
    return [{ index, ...describeName(fileName) }];
  });
  const duplicateTrackTitles = groupDuplicateNames(trackNames);
  const duplicateFileNames = groupDuplicateNames(fileNames);
  const tracksByName = new Map<string, number[]>();
  const filesByName = new Map<string, number[]>();

  for (const track of trackNames) {
    if (!track.normalizedName) continue;
    tracksByName.set(track.normalizedName, [
      ...(tracksByName.get(track.normalizedName) ?? []),
      track.index,
    ]);
  }
  for (const file of fileNames) {
    if (!file.normalizedName) continue;
    filesByName.set(file.normalizedName, [
      ...(filesByName.get(file.normalizedName) ?? []),
      file.index,
    ]);
  }

  const matches: AlbumTrackFileMatch[] = [];
  const matchedTracks = new Set<number>();
  const matchedFiles = new Set<number>();

  for (const [normalizedName, trackIndexes] of tracksByName) {
    const fileIndexes = filesByName.get(normalizedName) ?? [];
    if (trackIndexes.length !== 1 || fileIndexes.length !== 1) continue;
    const trackIndex = trackIndexes[0];
    const fileIndex = fileIndexes[0];
    matches.push({
      trackIndex,
      fileIndex,
      reason: "normalized-title",
      normalizedName,
    });
    matchedTracks.add(trackIndex);
    matchedFiles.add(fileIndex);
  }

  const filesByTrackNumber = new Map<number, typeof fileNames>();
  for (const file of fileNames) {
    if (file.trackNumber === null || matchedFiles.has(file.index)) continue;
    const numberedFiles = filesByTrackNumber.get(file.trackNumber) ?? [];
    numberedFiles.push(file);
    filesByTrackNumber.set(file.trackNumber, numberedFiles);
  }

  for (const track of trackNames) {
    if (matchedTracks.has(track.index)) continue;
    const numberedFiles = filesByTrackNumber.get(track.index + 1) ?? [];
    if (numberedFiles.length !== 1) continue;
    const [file] = numberedFiles;
    if (
      file.normalizedName &&
      file.normalizedName !== track.normalizedName
    ) {
      continue;
    }

    matches.push({
      trackIndex: track.index,
      fileIndex: file.index,
      reason: "track-number",
      normalizedName: track.normalizedName,
    });
    matchedTracks.add(track.index);
    matchedFiles.add(file.index);
  }

  matches.sort((left, right) => left.trackIndex - right.trackIndex);

  return {
    matches,
    missingTrackIndexes: tracks
      .map((_, index) => index)
      .filter((index) => !matchedTracks.has(index)),
    unmatchedFileIndexes: fileNames
      .map((file) => file.index)
      .filter((index) => !matchedFiles.has(index)),
    unsupportedFileIndexes,
    duplicateTrackTitles,
    duplicateFileNames,
  };
};
