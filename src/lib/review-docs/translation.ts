import { createHash } from "node:crypto";
import { inlineLyricTranslation } from "../foreign-lyrics";
import { isUsableLyricsTranslation, translateLyricsBatch } from "../server-lyrics-translation";
import { foreignLyricSpans, REVIEW_DOC_LIMITS, reviewDocumentDataSchema, type ReviewDocumentData, type ReviewTrack } from "./model";

export function renderTrackLyrics(track: ReviewTrack) {
  if (track.instrumentalConfirmed && track.lyricStatus === "instrumental") return "가사 없음 / Instrumental";
  if (track.lyricStatus === "none" && track.reviewedFields.includes("lyrics")) return "가사 없음";
  let lyrics = track.lyrics;
  for (const segment of [...track.translationSegments].sort((a, b) => b.start - a.start)) {
    if (!segment.translation.trim() || segment.end <= segment.start || lyrics.slice(segment.start, segment.end) !== segment.source) continue;
    if (inlineLyricTranslation(lyrics.slice(segment.end))) continue;
    lyrics = `${lyrics.slice(0, segment.end)} (번역 : ${segment.translation.trim()})${lyrics.slice(segment.end)}`;
  }
  return lyrics.replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim();
}

export type TranslationProvider = (segments: string[]) => Promise<string[] | null>;

export class ReviewLyricsTranslationError extends Error {
  readonly code = "REVIEW_TRANSLATION_FAILED";
  readonly status = 502;
  constructor(message = "외국어 가사 번역 서비스 연결에 실패했습니다. 번역 서비스 설정과 운영 로그를 확인한 뒤 다시 생성해주세요.") {
    super(message);
    this.name = "ReviewLyricsTranslationError";
  }
}

type ReviewLyricsInput = { lyrics: string; translatedLyrics?: string | null; lyricsWithTranslation?: string | null };

function hasSameOriginalLyrics(original: string, candidate: string) {
  let sourceIndex = 0;
  let candidateIndex = 0;
  while (sourceIndex < original.length || candidateIndex < candidate.length) {
    if (/\s/.test(original[sourceIndex] ?? "")) { sourceIndex += 1; continue; }
    if (/\s/.test(candidate[candidateIndex] ?? "")) { candidateIndex += 1; continue; }
    // Matching original parentheses take precedence over skipping new annotations.
    if (original[sourceIndex] === candidate[candidateIndex]) { sourceIndex += 1; candidateIndex += 1; continue; }
    const annotation = inlineLyricTranslation(candidate.slice(candidateIndex));
    if (annotation) { candidateIndex += annotation.text.length; continue; }
    const existing = /^(?:\(|（|\[|\{)?[ \t]*(?:번역|해석)[ \t]*[:：]/.test(original.slice(sourceIndex))
      ? inlineLyricTranslation(original.slice(sourceIndex)) : null;
    if (existing) { sourceIndex += existing.text.length; continue; }
    return false;
  }
  return true;
}

/** One shared translation pass feeds every DOCX, including saved URL submissions. */
export async function translateLyricsForReviewDocuments(
  tracks: ReviewLyricsInput[],
  options: { translate?: TranslationProvider; timeoutMs?: number } = {},
): Promise<string[]> {
  const prepared = tracks.map((track) => {
    let lyrics = track.lyrics.replace(/\r\n?/g, "\n");
    let separateTranslation = "";
    for (const { candidate, translationOnlyAllowed } of [
      { candidate: track.lyricsWithTranslation, translationOnlyAllowed: false },
      { candidate: track.translatedLyrics, translationOnlyAllowed: true },
    ]) {
      if (!candidate?.trim() || candidate.trim() === lyrics.trim()) continue;
      if (hasSameOriginalLyrics(lyrics, candidate)) {
        lyrics = candidate.replace(/\r\n?/g, "\n");
        break;
      }
      // A saved full lyric text with different originals may be stale; never replace current lyrics.
      if (translationOnlyAllowed && foreignLyricSpans(lyrics).length && !foreignLyricSpans(candidate).length) separateTranslation = candidate.trim();
    }
    const pending = foreignLyricSpans(lyrics).filter((span) => !inlineLyricTranslation(lyrics.slice(span.end)));
    if (separateTranslation && new Set(pending.map((span) => span.source)).size === 1) {
      for (const span of [...pending].reverse()) {
        lyrics = `${lyrics.slice(0, span.end)} (번역 : ${separateTranslation})${lyrics.slice(span.end)}`;
      }
      separateTranslation = "";
    }
    return { lyrics, separateTranslation, spans: foreignLyricSpans(lyrics).filter((span) => !inlineLyricTranslation(lyrics.slice(span.end))) };
  });
  const sources = [...new Set(prepared.flatMap((track) => track.spans.map((span) => span.source)))];
  if (sources.reduce((sum, source) => sum + source.length, 0) > REVIEW_DOC_LIMITS.translationCharacters) {
    throw new ReviewLyricsTranslationError("외국어 가사가 한 번에 번역 가능한 60,000자를 넘었습니다. 음반을 나누어 DOCX ZIP을 생성해주세요.");
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const provider = options.translate ?? ((segments) => translateLyricsBatch(segments, { source: "auto", target: "ko", signal: controller.signal }));
  const providerError = () => new ReviewLyricsTranslationError(
    !options.translate && !process.env.OPENAI_API_KEY?.trim()
      ? "외국어 가사 번역에 실패했습니다. 서버에 번역용 OPENAI_API_KEY가 없고 대체 번역 서비스도 응답하지 못했습니다. 관리자에게 번역 서비스 설정을 요청해주세요."
      : undefined,
  );
  const sourceChunks = new Map(sources.map((source) => {
    const chunks: string[] = [];
    let remaining = source;
    while (remaining.length > 4000) {
      const space = remaining.lastIndexOf(" ", 4000);
      let end = space > 2000 ? space : 4000;
      // Never cut between UTF-16 surrogate halves.
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end -= 1;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return [source, chunks] as const;
  }));
  const uniqueChunks = [...new Set([...sourceChunks.values()].flat())];
  const batches: string[][] = [];
  for (const chunk of uniqueChunks) {
    let batch = batches.at(-1);
    if (!batch || batch.length >= 20 || batch.reduce((sum, value) => sum + value.length, 0) + chunk.length > 4000) {
      batch = [];
      batches.push(batch);
    }
    batch.push(chunk);
  }
  const translated = new Map<string, string>();
  // Bound concurrent requests and the whole album pass. Serial model timeouts
  // must not consume the entire budget before later tracks can be translated.
  if (batches.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextBatch = 0;
    try {
      await Promise.race([
        Promise.all(Array.from({ length: Math.min(2, batches.length) }, async () => {
          while (nextBatch < batches.length) {
            controller.signal.throwIfAborted();
            const batch = batches[nextBatch++];
            const result = await provider(batch);
            if (!result || result.length !== batch.length || result.some((value, index) => typeof value !== "string" || !isUsableLyricsTranslation(value, batch[index]))) {
              throw providerError();
            }
            result.forEach((value, index) => translated.set(batch[index], value.trim()));
          }
        })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ReviewLyricsTranslationError(
            "외국어 가사 번역 대기 시간을 초과했습니다. 음반을 나누어 생성하거나 번역 서비스 상태를 확인해주세요.",
          )), timeoutMs);
        }),
      ]);
    } catch (error) {
      controller.abort();
      throw error instanceof ReviewLyricsTranslationError ? error : providerError();
    } finally {
      clearTimeout(timer);
    }
  }
  return prepared.map(({ lyrics, spans, separateTranslation }) => {
    for (const span of [...spans].reverse()) {
      const translation = sourceChunks.get(span.source)!.map((chunk) => translated.get(chunk)!).join(" ");
      lyrics = `${lyrics.slice(0, span.end)} (번역 : ${translation})${lyrics.slice(span.end)}`;
    }
    return separateTranslation ? `${lyrics}\n\n(번역 : ${separateTranslation})` : lyrics;
  });
}

export async function translateReviewData(input: ReviewDocumentData, options: { translate?: TranslationProvider; signal?: AbortSignal } = {}): Promise<ReviewDocumentData> {
  options.signal?.throwIfAborted();
  const data = reviewDocumentDataSchema.parse(structuredClone(input));
  data.issues = data.issues.filter((issue) => !["TRANSLATION_UNAVAILABLE", "TRANSLATION_LIMIT"].includes(issue.code));
  const provider = options.translate ?? ((segments) => translateLyricsBatch(segments, { source: "auto", target: "ko", signal: options.signal }));
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
      const inline = inlineLyricTranslation(track.lyrics.slice(span.end));
      // Separately supplied translations require explicit alignment; never replace them with a new guess.
      if (track.existingTranslation.trim() && !inline) continue;
      const id = createHash("sha256").update(`${track.id}:${span.start}:${span.source}`).digest("hex").slice(0, 20);
      track.translationSegments.push({ id, ...span, translation: inline?.translation ?? "", origin: inline ? "existing" : "provider", confirmed: !!inline });
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
    options.signal?.throwIfAborted();
    try {
      const result = await provider(batch);
      if (!result || result.length !== batch.length) { failed = true; return; }
      result.forEach((translation, index) => {
        if (typeof translation === "string" && isUsableLyricsTranslation(translation, batch[index])) translated.set(batch[index], translation.trim());
        else failed = true;
      });
    } catch { options.signal?.throwIfAborted(); failed = true; }
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
  if (failed) data.issues.push({ id: "translation:unavailable", code: "TRANSLATION_UNAVAILABLE", severity: "warning", message: "번역 서비스 요청이 실패했거나 일부 구간을 번역하지 못했습니다. 재시도하거나 구간별 한글 번역을 입력해주세요." });
  return data;
}
