export type AlbumTrackRowKeyState = Readonly<{
  prefix: string;
  nextSequence: number;
  keys: readonly string[];
}>;

const normalizeCount = (count: number) =>
  Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

const normalizePrefix = (prefix: string) =>
  prefix.trim().replace(/[^a-zA-Z0-9_-]+/g, "-") || "album-track";

const nextRowKey = (state: AlbumTrackRowKeyState) =>
  `${state.prefix}-${state.nextSequence}`;

/**
 * A tiny immutable key state for React track rows. The monotonic sequence is
 * never rewound, so deleting a row and adding another cannot recycle its key.
 */
export const createAlbumTrackRowKeyState = (
  count: number,
  prefix = "album-track",
): AlbumTrackRowKeyState => {
  const safeCount = normalizeCount(count);
  const safePrefix = normalizePrefix(prefix);

  return {
    prefix: safePrefix,
    nextSequence: safeCount + 1,
    keys: Array.from(
      { length: safeCount },
      (_, index) => `${safePrefix}-${index + 1}`,
    ),
  };
};

export const insertAlbumTrackRowKey = (
  state: AlbumTrackRowKeyState,
  index = state.keys.length,
): AlbumTrackRowKeyState => {
  const insertIndex = Math.min(
    state.keys.length,
    Math.max(0, Math.floor(Number.isFinite(index) ? index : state.keys.length)),
  );
  const key = nextRowKey(state);

  return {
    ...state,
    nextSequence: state.nextSequence + 1,
    keys: [
      ...state.keys.slice(0, insertIndex),
      key,
      ...state.keys.slice(insertIndex),
    ],
  };
};

export const appendAlbumTrackRowKey = (state: AlbumTrackRowKeyState) =>
  insertAlbumTrackRowKey(state, state.keys.length);

export const removeAlbumTrackRowKey = (
  state: AlbumTrackRowKeyState,
  index: number,
): AlbumTrackRowKeyState => {
  if (!Number.isInteger(index) || index < 0 || index >= state.keys.length) {
    return state;
  }

  return {
    ...state,
    keys: state.keys.filter((_, keyIndex) => keyIndex !== index),
  };
};

export const moveAlbumTrackRowKey = (
  state: AlbumTrackRowKeyState,
  fromIndex: number,
  toIndex: number,
): AlbumTrackRowKeyState => {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    fromIndex >= state.keys.length ||
    toIndex < 0 ||
    toIndex >= state.keys.length ||
    fromIndex === toIndex
  ) {
    return state;
  }

  const keys = [...state.keys];
  const [movedKey] = keys.splice(fromIndex, 1);
  keys.splice(toIndex, 0, movedKey);

  return { ...state, keys };
};

export const resizeAlbumTrackRowKeyState = (
  state: AlbumTrackRowKeyState,
  count: number,
): AlbumTrackRowKeyState => {
  const safeCount = normalizeCount(count);
  if (safeCount === state.keys.length) return state;
  if (safeCount < state.keys.length) {
    return { ...state, keys: state.keys.slice(0, safeCount) };
  }

  let resized = state;
  while (resized.keys.length < safeCount) {
    resized = appendAlbumTrackRowKey(resized);
  }
  return resized;
};

export const ALBUM_TRACK_PASTE_FIELDS = [
  "trackTitle",
  "performer",
  "featuring",
  "composer",
  "lyricist",
  "arranger",
] as const;

/**
 * Headerless clipboard rows follow the five columns visible in the quick-edit
 * table. Featuring remains available when the pasted table names that column,
 * but it must not silently shift composer/lyricist/arranger one cell to the
 * right.
 */
const ALBUM_TRACK_HEADERLESS_PASTE_FIELDS = [
  "trackTitle",
  "performer",
  "composer",
  "lyricist",
  "arranger",
] as const satisfies readonly AlbumTrackPasteField[];

export type AlbumTrackPasteField =
  (typeof ALBUM_TRACK_PASTE_FIELDS)[number];

export type AlbumTrackPasteRow = Partial<
  Record<AlbumTrackPasteField, string>
>;

export type AlbumTrackPasteResult = {
  delimiter: "," | "\t";
  hasHeader: boolean;
  headers: string[];
  ignoredHeaders: string[];
  rows: AlbumTrackPasteRow[];
  issues: string[];
};

const normalizeHeader = (header: string) =>
  header
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s_()\[\]./-]+/g, "");

const headerAliases: Record<string, AlbumTrackPasteField> = {};

const registerHeaderAliases = (
  field: AlbumTrackPasteField,
  aliases: readonly string[],
) => {
  for (const alias of aliases) {
    headerAliases[normalizeHeader(alias)] = field;
  }
};

registerHeaderAliases("trackTitle", [
  "trackTitle",
  "track title",
  "track",
  "title",
  "트랙명",
  "곡명",
  "곡 제목",
  "제목",
]);
registerHeaderAliases("performer", [
  "performer",
  "artist",
  "artist name",
  "가수",
  "가수명",
  "아티스트",
  "아티스트명",
]);
registerHeaderAliases("featuring", [
  "featuring",
  "featured artist",
  "feat",
  "피처링",
  "피처링 가수",
]);
registerHeaderAliases("composer", ["composer", "작곡", "작곡가"]);
registerHeaderAliases("lyricist", [
  "lyricist",
  "lyrics by",
  "작사",
  "작사가",
]);
registerHeaderAliases("arranger", ["arranger", "편곡", "편곡가"]);

const countDelimiterOutsideQuotes = (input: string, delimiter: string) => {
  let count = 0;
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      count += 1;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      break;
    }
  }

  return count;
};

const detectDelimiter = (input: string): "," | "\t" =>
  countDelimiterOutsideQuotes(input, "\t") >
  countDelimiterOutsideQuotes(input, ",")
    ? "\t"
    : ",";

const parseDelimitedRows = (input: string, delimiter: "," | "\t") => {
  const rows: string[][] = [];
  const issues: string[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) issues.push("닫히지 않은 따옴표가 있습니다.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  return { rows, issues };
};

const headerFieldFor = (header: string) =>
  headerAliases[normalizeHeader(header)];

/** Parses table data copied from Excel/Sheets (TSV) or a CSV file. */
export const parseAlbumTrackTablePaste = (
  input: string,
): AlbumTrackPasteResult => {
  const normalizedInput = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalizedInput);
  const parsed = parseDelimitedRows(normalizedInput, delimiter);
  const firstRow = parsed.rows[0] ?? [];
  const recognizedHeaderCount = firstRow.filter(headerFieldFor).length;
  const hasHeader =
    recognizedHeaderCount >= 2 ||
    (parsed.rows.length > 1 && recognizedHeaderCount === firstRow.length && recognizedHeaderCount > 0);
  const headers = hasHeader ? firstRow : [];
  const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
  const fields = hasHeader
    ? firstRow.map(headerFieldFor)
    : [...ALBUM_TRACK_HEADERLESS_PASTE_FIELDS];
  const ignoredHeaders = hasHeader
    ? firstRow.filter((header, index) => !fields[index])
    : [];
  const duplicateFields = new Set<AlbumTrackPasteField>();
  const seenFields = new Set<AlbumTrackPasteField>();

  for (const field of fields) {
    if (!field) continue;
    if (seenFields.has(field)) duplicateFields.add(field);
    seenFields.add(field);
  }

  const rows = dataRows
    .map((cells) => {
      const result: AlbumTrackPasteRow = {};
      const assignedFields = new Set<AlbumTrackPasteField>();

      cells.forEach((value, index) => {
        const field = fields[index];
        if (!field || assignedFields.has(field) || !value) return;
        result[field] = value;
        assignedFields.add(field);
      });

      return result;
    })
    .filter((row) => Object.keys(row).length > 0);

  const issues = [...parsed.issues];
  if (duplicateFields.size > 0) {
    issues.push("같은 의미의 열 제목이 중복되어 첫 번째 열만 반영했습니다.");
  }

  return {
    delimiter,
    hasHeader,
    headers,
    ignoredHeaders,
    rows,
    issues,
  };
};

type AlbumTrackPasteCompatible = Record<AlbumTrackPasteField, string>;

/**
 * Applies pasted cells without clearing fields the user already entered. In
 * particular, a compilation track's performer remains untouched when the
 * pasted table does not contain a performer cell for that row.
 */
export const mergeAlbumTrackPasteRows = <
  TTrack extends AlbumTrackPasteCompatible,
>(
  tracks: readonly TTrack[],
  pastedRows: readonly AlbumTrackPasteRow[],
  createTrack: () => TTrack,
  startIndex = 0,
): TTrack[] => {
  const safeStartIndex = Math.min(
    tracks.length,
    Math.max(0, Math.floor(Number.isFinite(startIndex) ? startIndex : 0)),
  );
  const merged = [...tracks];

  pastedRows.forEach((pastedRow, offset) => {
    const index = safeStartIndex + offset;
    const base = merged[index] ?? createTrack();
    const additions: AlbumTrackPasteRow = {};

    for (const field of ALBUM_TRACK_PASTE_FIELDS) {
      const value = pastedRow[field]?.trim();
      if (value) additions[field] = value;
    }

    merged[index] = { ...base, ...additions };
  });

  return merged;
};
