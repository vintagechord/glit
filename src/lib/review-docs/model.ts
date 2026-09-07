import { z } from "zod";

export const REVIEW_DOC_LIMITS = {
  files: 8, fileBytes: 10 * 1024 * 1024, totalBytes: 40 * 1024 * 1024,
  pages: 80, albums: 8, tracks: 100, urls: 8,
  sourceCharacters: 600_000, lyricCharacters: 80_000,
  translationCharacters: 60_000, conversionSeconds: 90, concurrentConversions: 1,
} as const;
const text = z.string().max(10_000).default("");
export const reviewEvidenceSchema = z.object({
  sourceId: z.string().max(100), field: z.string().max(100),
  location: z.string().max(300), excerpt: z.string().max(2000).default(""),
});
export const reviewIssueSchema = z.object({
  id: z.string().max(200), code: z.string().max(100),
  severity: z.enum(["warning", "error"]), message: z.string().max(2000),
  albumId: z.string().optional(), trackId: z.string().optional(),
  sourceId: z.string().optional(), field: z.string().optional(),
});
export const reviewSourceSchema = z.object({
  id: z.string().max(100), kind: z.enum(["file", "melon", "genie"]),
  name: z.string().max(500), url: z.string().max(2000).optional(),
  mimeType: z.string().max(200).optional(), sha256: z.string().optional(),
  text: z.string().max(REVIEW_DOC_LIMITS.sourceCharacters).default(""),
  pageCount: z.number().int().nonnegative().optional(),
  format: z.string().optional(), warnings: z.array(z.string()).default([]),
});
export const translationSegmentSchema = z.object({
  id: z.string().max(100), source: z.string().max(10_000),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  translation: z.string().max(20_000).default(""),
  language: z.enum(["en", "ja", "other"]).default("other"),
  origin: z.enum(["existing", "provider", "admin"]),
  confirmed: z.boolean().default(false),
});
export const reviewTrackSchema = z.object({
  id: z.string().max(100), number: z.number().int().min(1).max(999), title: text,
  artistName: text, isTitle: z.boolean().default(false), titleConfirmed: z.boolean().default(false),
  lyricist: text, composer: text, arranger: text, featuring: text, performers: text,
  lyrics: z.string().max(REVIEW_DOC_LIMITS.lyricCharacters).default(""),
  existingTranslation: z.string().max(REVIEW_DOC_LIMITS.lyricCharacters).default(""),
  translationSegments: z.array(translationSegmentSchema).max(10_000).default([]),
  lyricStatus: z.enum(["provided", "not_provided", "extraction_failed", "none", "instrumental"]).default("not_provided"),
  instrumentalConfirmed: z.boolean().default(false),
  sourceIds: z.array(z.string()).default([]), evidence: z.array(reviewEvidenceSchema).default([]),
  reviewedFields: z.array(z.string()).default([]),
});
export const reviewAlbumSchema = z.object({
  id: z.string().max(100), artistName: text, artistNameEn: text, title: text,
  company: text, distributor: text, releaseDate: text, productionDate: text,
  genre: text, albumType: text, actType: text, members: text, previousReleases: text,
  declaredTrackCount: z.number().int().nonnegative().optional(),
  sourceIds: z.array(z.string()).default([]), evidence: z.array(reviewEvidenceSchema).default([]),
  tracks: z.array(reviewTrackSchema).max(REVIEW_DOC_LIMITS.tracks),
  wbsTrackIds: z.array(z.string()).max(3).default([]), reviewedFields: z.array(z.string()).default([]),
});
export const reviewDocumentDataSchema = z.object({
  schemaVersion: z.literal(1).default(1), mode: z.enum(["album", "mv"]),
  applicationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: z.array(reviewSourceSchema).max(REVIEW_DOC_LIMITS.files + REVIEW_DOC_LIMITS.urls).default([]),
  albums: z.array(reviewAlbumSchema).max(REVIEW_DOC_LIMITS.albums),
  issues: z.array(reviewIssueSchema).default([]), confirmedIssueIds: z.array(z.string()).default([]),
});
export type ReviewDocumentData = z.infer<typeof reviewDocumentDataSchema>;
export type ReviewAlbum = z.infer<typeof reviewAlbumSchema>;
export type ReviewTrack = z.infer<typeof reviewTrackSchema>;
export type ReviewSource = z.infer<typeof reviewSourceSchema>;
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
export type TranslationSegment = z.infer<typeof translationSegmentSchema>;
export type ReviewMode = ReviewDocumentData["mode"];

export function seoulApplicationDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** Normalizes only exact, valid calendar dates; retains uncertain source wording. */
export function normalizeReviewDate(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})\s*(?:[.\/-]|년)\s*(\d{1,2})\s*(?:[.\/-]|월)\s*(\d{1,2})\s*일?\.?$/);
  if (!match) return trimmed;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return trimmed;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
export function isReviewCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
}
export function explicitTitle(value: string) {
  return /^(?:[☑☒✓✔■●]+|예|네|yes|true|1)(?:\s*(?:곡|타이틀|title))?$/i.test(value.trim());
}
export function explicitInstrumental(value: string) {
  return /^(?:inst\.?|instrumental|mr|반주곡|연주곡|karaoke)$/i.test(value.trim()) || /(?:\(|\[)\s*(?:inst\.?|instrumental|mr|karaoke)(?:\s*(?:ver\.?|version))?\s*(?:\)|\])\s*$/i.test(value.trim());
}
export function emptyReviewData(mode: ReviewMode, applicationDate = seoulApplicationDate()): ReviewDocumentData {
  return reviewDocumentDataSchema.parse({ mode, applicationDate, albums: [] });
}
const sourceFailures = new Set(["UNSUPPORTED_FORMAT", "FORMAT_MISMATCH", "SIGNATURE_MISMATCH", "ENCRYPTED", "CONVERTER_UNAVAILABLE", "CONVERTER_TIMEOUT", "CONVERSION_FAILED", "OCR_UNAVAILABLE", "OCR_LANGUAGE_MISSING", "PDF_EXTRACTION_FAILED", "HWP_CORRUPT_OR_UNSUPPORTED", "HWP_DISTRIBUTION", "HWP_DRM", "HWP_BODY_MISSING", "CORRUPT", "EMPTY_DOCUMENT", "TEXT_LIMIT", "TOTAL_TEXT_LIMIT", "URL_EXTRACTION_FAILED", "EXTRACTION_FAILED", "ARCHIVE_LIMIT", "XML_UNSAFE", "ACTIVE_CONTENT", "ARCHIVE_PATH", "PAGE_LIMIT", "EXTRACTION_LIMIT", "DOC_CONVERSION_FAILED"]);
export function canConfirmReviewIssue(issue: ReviewIssue) {
  return !sourceFailures.has(issue.code);
}
export function validateReviewData(input: ReviewDocumentData): ReviewIssue[] {
  const data = reviewDocumentDataSchema.parse(input);
  const issues: ReviewIssue[] = data.issues.filter((issue) => !canConfirmReviewIssue(issue) || !data.confirmedIssueIds.includes(issue.id));
  const add = (code: string, message: string, album?: ReviewAlbum, track?: ReviewTrack, field?: string, severity: ReviewIssue["severity"] = "error") => {
    issues.push({ id: `${code}:${track?.id ?? album?.id ?? "data"}:${field ?? ""}`, code, severity, message, albumId: album?.id, trackId: track?.id, field });
  };
  const sourceIds = new Set(data.sources.map((s) => s.id));
  if (!isReviewCalendarDate(data.applicationDate)) add("APPLICATION_DATE_INVALID", "신청일자가 유효하지 않습니다.");
  if (!data.albums.length) add("ALBUM_REQUIRED", "추출된 앨범 또는 곡이 없습니다. 원문을 확인해 추가해주세요.");
  if (data.albums.reduce((n, a) => n + a.tracks.length, 0) > REVIEW_DOC_LIMITS.tracks) add("TRACK_LIMIT", `전체 ${REVIEW_DOC_LIMITS.tracks}곡까지만 처리할 수 있습니다.`);
  const ids = new Set<string>();
  const albumKeys = new Set<string>();
  for (const album of data.albums) {
    if (ids.has(album.id)) add("DUPLICATE_ID", "앨범 ID가 중복됩니다.", album);
    ids.add(album.id);
    const key = `${album.artistName.trim().normalize("NFC")}\0${album.title.trim().normalize("NFC")}`;
    if (album.title && albumKeys.has(key) && !album.reviewedFields.includes("separateAlbum")) add("DUPLICATE_ALBUM", "같은 아티스트·앨범명이 있습니다. 자료를 합치거나 별도 앨범임을 확인해주세요.", album, undefined, "separateAlbum");
    albumKeys.add(key);
    if (!album.artistName.trim() && !album.tracks.every((t) => t.artistName.trim())) add("ARTIST_REQUIRED", "아티스트명을 입력해주세요.", album, undefined, "artistName");
    if (data.mode === "album") {
      if (!album.title.trim()) add("ALBUM_TITLE_REQUIRED", "앨범명을 입력해주세요.", album, undefined, "title");
      if (!album.company.trim()) add("COMPANY_MISSING", "실제 기획사·소속사·제작사가 없어 빈칸으로 출력합니다.", album, undefined, "company", "warning");
      for (const field of ["releaseDate", "productionDate"] as const) {
        if (album[field] && !isReviewCalendarDate(normalizeReviewDate(album[field]))) add("DATE_UNCERTAIN", `${field === "releaseDate" ? "발매일" : "제작일"}이 확정 날짜가 아닙니다. 원문 그대로 유지합니다.`, album, undefined, field, "warning");
      }
      if (!album.productionDate && album.releaseDate) add("PRODUCTION_DATE_FALLBACK", "제작일이 없어 발매일을 적용합니다.", album, undefined, "productionDate", "warning");
      if (!album.tracks.some((t) => t.isTitle && t.titleConfirmed)) add("REPRESENTATIVE_FALLBACK", "타이틀 지정이 없어 통합신청서 대표곡에 첫 번째 트랙을 사용합니다.", album, undefined, undefined, "warning");
      if (album.tracks.filter((t) => t.isTitle && t.titleConfirmed).length > 3 && album.wbsTrackIds.length === 0) add("WBS_SELECTION_REQUIRED", "타이틀곡이 3곡을 넘습니다. WBS 신청곡을 최대 3곡 선택해주세요.", album, undefined, "wbsTrackIds");
    }
    if (!album.tracks.length) add("TRACK_REQUIRED", "앨범의 트랙을 추가해주세요.", album);
    if (album.declaredTrackCount !== undefined && album.declaredTrackCount !== album.tracks.length && !album.reviewedFields.includes("declaredTrackCount")) add("TRACK_COUNT_MISMATCH", `원문 트랙 수 ${album.declaredTrackCount}곡과 추출된 ${album.tracks.length}곡이 다릅니다.`, album, undefined, "declaredTrackCount");
    for (const entry of album.evidence) if (!sourceIds.has(entry.sourceId)) add("EVIDENCE_INVALID", "앨범 근거에 연결된 원본이 없습니다.", album);
    for (const sourceId of album.sourceIds) if (!sourceIds.has(sourceId)) add("SOURCE_INVALID", "앨범에 연결된 원본이 없습니다.", album);
    if (new Set(album.wbsTrackIds).size !== album.wbsTrackIds.length || album.wbsTrackIds.some((id) => !album.tracks.some((t) => t.id === id))) add("WBS_SELECTION_INVALID", "WBS 신청곡 연결이 올바르지 않습니다.", album);
    const numbers = new Set<number>();
    for (const track of album.tracks) {
      if (ids.has(track.id)) add("DUPLICATE_ID", "곡 ID가 중복됩니다.", album, track);
      ids.add(track.id);
      if (numbers.has(track.number)) add("TRACK_NUMBER_DUPLICATE", "트랙번호가 중복됩니다. 순서를 수정해주세요.", album, track, "number");
      numbers.add(track.number);
      if (!track.title.trim()) add("TRACK_TITLE_REQUIRED", "곡명을 입력해주세요.", album, track, "title");
      if (track.isTitle && !track.titleConfirmed) add("TITLE_UNCONFIRMED", "타이틀 여부를 원문과 비교해 확인해주세요.", album, track, "isTitle");
      if (["none", "instrumental"].includes(track.lyricStatus) && !track.instrumentalConfirmed && !track.reviewedFields.includes("lyrics")) add("LYRIC_STATUS_UNCONFIRMED", "가사 없음 여부를 확인해주세요. 빈 가사를 연주곡으로 추측하지 않습니다.", album, track, "lyrics");
      if (track.lyricStatus === "instrumental" && !track.instrumentalConfirmed) add("INSTRUMENTAL_UNCONFIRMED", "Inst./MR을 확인해주세요.", album, track, "instrumentalConfirmed");
      if (!track.instrumentalConfirmed && track.lyricStatus !== "none" && (!track.lyrics.trim() || track.lyricStatus === "extraction_failed")) add("LYRICS_REQUIRED", track.lyricStatus === "extraction_failed" ? "가사 추출에 실패했습니다. 원문과 비교해 보완해주세요." : "가사가 제공되지 않았습니다. 가사를 입력하거나 가사 없음 여부를 확인해주세요.", album, track, "lyrics");
      if (track.instrumentalConfirmed && track.lyricStatus === "extraction_failed") add("TRACK_DETAILS_FAILED", "연주곡의 상세 정보 조회가 실패했습니다. 원본 크레딧을 확인해주세요.", album, track, "lyricStatus", "warning");
      if (track.instrumentalConfirmed && track.lyrics.trim() && !track.reviewedFields.includes("instrumentalConfirmed")) add("INSTRUMENTAL_LYRIC_CONFLICT", "연주곡 표시와 가사가 함께 있습니다. 원문을 확인해주세요.", album, track, "instrumentalConfirmed");
      for (const entry of track.evidence) if (!sourceIds.has(entry.sourceId)) add("EVIDENCE_INVALID", "곡 근거에 연결된 원본이 없습니다.", album, track);
      for (const sourceId of track.sourceIds) if (!sourceIds.has(sourceId)) add("SOURCE_INVALID", "곡에 연결된 원본이 없습니다.", album, track);
      if (!track.instrumentalConfirmed && track.existingTranslation.trim() && !track.translationSegments.length && !track.reviewedFields.includes("existingTranslation")) add("EXISTING_TRANSLATION_ALIGNMENT", "별도 번역의 원문 대응 관계를 확인해주세요. 줄 번호만으로 합치지 않습니다.", album, track, "translationSegments");
      if (!track.instrumentalConfirmed) for (const span of foreignLyricSpans(track.lyrics)) {
        const inline = /^\s*\((?:번역|해석)\s*[:：]\s*[^)]+\)/.test(track.lyrics.slice(span.end));
        if (!inline && !track.translationSegments.some((s) => s.start <= span.start && s.end >= span.end && s.translation.trim())) add("TRANSLATION_MISSING", "외국어 가사의 한글 번역 또는 구간별 번역 확인이 필요합니다.", album, track, "translationSegments");
      }
      let previousEnd = 0;
      for (const segment of [...track.translationSegments].sort((a, b) => a.start - b.start)) {
        if (segment.start < previousEnd || segment.end <= segment.start || track.lyrics.slice(segment.start, segment.end) !== segment.source) add("TRANSLATION_ALIGNMENT", "원문과 번역 구간의 연결이 달라졌습니다. 번역 구간을 다시 확인해주세요.", album, track, "translationSegments");
        previousEnd = segment.end;
        if (!segment.translation.trim() || !segment.confirmed) add("TRANSLATION_REVIEW", "번역이 누락되었거나 검토되지 않았습니다.", album, track, "translationSegments");
      }
    }
  }
  return [...new Map(issues.map((i) => [i.id, i])).values()];
}

/** Character offsets anchor translations to exact source spans, including repeated occurrences. */
export function foreignLyricSpans(lyrics: string): { start: number; end: number; source: string; language: "en" | "ja" | "other" }[] {
  const spans: { start: number; end: number; source: string; language: "en" | "ja" | "other" }[] = [];
  const annotations = [...lyrics.matchAll(/\((?:번역\s*[:：]|해석\s*[:：])[^)]*\)/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  // Foreign spans are bounded by Hangul/newlines. CJK with kana is Japanese; no English label is guessed.
  const pattern = /[A-Za-z\u3040-\u30ff\u3400-\u9fff][A-Za-z\u3040-\u30ff\u3400-\u9fff0-9 \t'’“”,.!?\-]*(?:[A-Za-z\u3040-\u30ff\u3400-\u9fff0-9.!?])?/g;
  for (const match of lyrics.matchAll(pattern)) {
    const source = match[0].trimEnd();
    const start = match.index;
    if (annotations.some((a) => start >= a.start && start < a.end)) continue;
    if (/^(?:oh|ooh|ah|aah|uh|hmm|la|na|yeah|hey|woah|woo)(?:[\s,!?.]+(?:oh|ooh|ah|aah|uh|hmm|la|na|yeah|hey|woah|woo))*[,!?.]*$/i.test(source)) continue;
    if (!source.trim()) continue;
    spans.push({ start, end: start + source.length, source, language: /[\u3040-\u30ff]/.test(source) ? "ja" : /[\u3400-\u9fff]/.test(source) ? "other" : "en" });
  }
  return spans;
}
