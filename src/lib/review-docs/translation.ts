import { createHash } from "node:crypto";
import { translateLyricsWithOpenAI } from "../openai-translation";
import { foreignLyricSpans, REVIEW_DOC_LIMITS, reviewDocumentDataSchema, type ReviewDocumentData, type ReviewTrack } from "./model";

export function renderTrackLyrics(track: ReviewTrack) {
  if (track.instrumentalConfirmed && track.lyricStatus === "instrumental") return "가사 없음 / Instrumental";
  if (track.lyricStatus === "none" && track.reviewedFields.includes("lyrics")) return "가사 없음";
  let lyrics = track.lyrics;
  for (const segment of [...track.translationSegments].sort((a, b) => b.start - a.start)) {
    if (!segment.translation.trim() || segment.end <= segment.start || lyrics.slice(segment.start, segment.end) !== segment.source) continue;
    if (/^\s*\((?:번역|해석)\s*[:：]/.test(lyrics.slice(segment.end))) continue;
    lyrics = `${lyrics.slice(0, segment.end)} (번역 : ${segment.translation.trim()})${lyrics.slice(segment.end)}`;
  }
  return lyrics.replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim();
}

type TranslationProvider = (segments: string[]) => Promise<string[] | null>;
export async function translateReviewData(input: ReviewDocumentData, options: { translate?: TranslationProvider } = {}): Promise<ReviewDocumentData> {
  const data = reviewDocumentDataSchema.parse(structuredClone(input));
  data.issues = data.issues.filter((issue) => !["TRANSLATION_UNAVAILABLE", "TRANSLATION_LIMIT"].includes(issue.code));
  const provider = options.translate ?? ((segments) => translateLyricsWithOpenAI(segments, { source: "auto", target: "ko" }));
  // Scope cache to this snapshot; no cross-customer lyrics or indefinite in-memory storage.
  const pending = new Map<string, string>();
  for (const album of data.albums) for (const track of album.tracks) {
    if (track.instrumentalConfirmed || track.reviewedFields.includes("translationSegments")) continue;
    for (const span of foreignLyricSpans(track.lyrics)) {
      const existingSegment = track.translationSegments.find((s) => s.start <= span.start && s.end >= span.end && track.lyrics.slice(s.start, s.end) === s.source);
      if (existingSegment) {
        if (existingSegment.origin === "provider" && !existingSegment.translation.trim()) pending.set(existingSegment.source, existingSegment.source);
        continue;
      }
      const inline = track.lyrics.slice(span.end).match(/^\s*\((?:번역|해석)\s*[:：]\s*([^)]+)\)/);
      // Separately supplied translations require explicit alignment; never replace them with a new guess.
      if (track.existingTranslation.trim() && !inline) continue;
      const id = createHash("sha256").update(`${track.id}:${span.start}:${span.source}`).digest("hex").slice(0, 20);
      track.translationSegments.push({ id, ...span, translation: inline?.[1].trim() ?? "", origin: inline ? "existing" : "provider", confirmed: !!inline });
      if (!inline) pending.set(span.source, span.source);
    }
  }
  const sourceTexts = [...pending.keys()];
  if (sourceTexts.reduce((n, s) => n + s.length, 0) > REVIEW_DOC_LIMITS.translationCharacters) {
    data.issues.push({ id: "translation:limit", code: "TRANSLATION_LIMIT", severity: "error", message: `번역 요청량이 ${REVIEW_DOC_LIMITS.translationCharacters.toLocaleString()}자를 넘습니다. 작업을 나누거나 기존 번역을 연결해주세요.` });
    return data;
  }
  const translated = new Map<string, string>();
  let failed = false;
  let batch: string[] = [];
  async function flush() {
    if (!batch.length || failed) return;
    try {
      const result = await provider(batch);
      if (!result || result.length !== batch.length) { failed = true; return; }
      result.forEach((translation, index) => {
        if (typeof translation === "string" && translation.trim() && /[가-힣]/.test(translation) && !/^(TODO|번역문|translation)$/i.test(translation.trim())) translated.set(batch[index], translation.trim());
      });
    } catch { failed = true; }
    batch = [];
  }
  for (const source of sourceTexts) {
    if (batch.length >= 20 || batch.reduce((n, s) => n + s.length, 0) + source.length > 4000) await flush();
    if (source.length > 4000) { failed = true; continue; }
    batch.push(source);
  }
  await flush();
  for (const album of data.albums) for (const track of album.tracks) for (const segment of track.translationSegments) {
    if (segment.origin === "provider" && !segment.translation && translated.has(segment.source)) segment.translation = translated.get(segment.source)!;
  }
  if (failed) data.issues.push({ id: "translation:unavailable", code: "TRANSLATION_UNAVAILABLE", severity: "warning", message: "기존 번역 서비스가 설정되지 않았거나 요청에 실패했습니다. 환경설정(OPENAI_API_KEY)을 확인 후 재시도하거나 구간별 한글 번역을 입력해주세요." });
  return data;
}
