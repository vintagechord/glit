/**
 * A wizard save replaces the whole application (parent row, tracks, lyrics,
 * files). The browser therefore sends the updated_at it last loaded or saved,
 * and the server refuses the save when the row has moved on since, instead of
 * letting an older tab or device silently replace newer edits.
 */
export const SUBMISSION_VERSION_CONFLICT_ERROR =
  "이 신청서가 다른 창이나 기기에서 먼저 저장되었습니다. 이 창의 입력은 이 기기에 보관했습니다. 최신 내용을 다시 불러온 뒤 이어서 작성해주세요.";

const timestampPattern =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Postgres returns timestamptz with microseconds, which a JavaScript Date
 * would truncate. Compare whole seconds plus the exact fractional digits.
 */
export const normalizeSubmissionVersion = (
  value: string | null | undefined,
) => {
  const match = typeof value === "string" ? timestampPattern.exec(value.trim()) : null;
  if (!match) return null;
  const [, date, time, fraction = "", zone = "Z"] = match;
  const offset =
    zone.toUpperCase() === "Z"
      ? "Z"
      : zone.length === 3
        ? `${zone}:00`
        : zone.includes(":")
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const seconds = Date.parse(`${date}T${time}${offset}`);
  if (!Number.isFinite(seconds)) return null;
  const micros = fraction.padEnd(6, "0").slice(0, 6);
  return `${seconds / 1000}.${micros}`;
};

export const isSameSubmissionVersion = (
  expected: string | null | undefined,
  actual: string | null | undefined,
) => {
  const left = normalizeSubmissionVersion(expected);
  return left !== null && left === normalizeSubmissionVersion(actual);
};

/** Keep the newest version the browser itself loaded or produced. */
export const recordSubmissionVersion = (
  versions: Map<string, string>,
  submissionId: string | null | undefined,
  updatedAt: unknown,
) => {
  if (!submissionId || typeof updatedAt !== "string") return;
  if (normalizeSubmissionVersion(updatedAt) === null) return;
  versions.set(submissionId, updatedAt);
};

/** The draft endpoint returned an existing draft that could not be loaded. */
export const REUSED_DRAFT_LOAD_ERROR =
  "저장된 신청서를 불러오지 못했습니다. 새로고침한 뒤 다시 시도해주세요.";
