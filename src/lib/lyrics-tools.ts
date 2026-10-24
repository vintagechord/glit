import { findForeignLyricsSpans, inlineLyricTranslation } from "./foreign-lyrics";
import { isUsableLyricsTranslation, LYRICS_TRANSLATION_LIMITS, lyricsTranslationBatches, normalizeLyricsTranslation, splitLyricsTranslationText, truncateLyricsContext, withLyricsTranslationSignal } from "./lyrics-translation-validation";

const koreanLetterPattern = /\p{Script=Hangul}/u;
const unicodeLetterPattern = /\p{L}/u;
const sentencePattern = /[^.!?。！？…]+[.!?。！？…]*/gu;

export type ForeignLyricSegment = {
  raw: string;
  start: number;
  end: number;
  sentences: string[];
};

export const hasNonKoreanLyrics = (value: string) => {
  for (const char of value) {
    if (!unicodeLetterPattern.test(char)) continue;
    if (!koreanLetterPattern.test(char)) return true;
  }
  return false;
};

export const splitForeignSentences = (value: string) => {
  const matches = value.match(sentencePattern);
  return matches?.map((item) => item.trim()).filter(Boolean) ?? [];
};

export const extractForeignSegments = (
  line: string,
): ForeignLyricSegment[] => findForeignLyricsSpans(line)
  .filter((span) => !inlineLyricTranslation(line.slice(span.end)))
  .map((span) => ({ raw: span.source, start: span.start, end: span.end, sentences: splitForeignSentences(span.source) }));

export const collectForeignLyricsSegments = (lyrics: string) => {
  const lines = lyrics.split("\n");
  const segmentMap = lines.map((line) => extractForeignSegments(line));
  const sentencesToTranslate = segmentMap.flatMap((segments) =>
    segments.flatMap((segment) => segment.sentences),
  );

  return { lines, segmentMap, sentencesToTranslate };
};

export const buildInlineTranslatedLyrics = (
  lines: string[],
  segmentMap: ForeignLyricSegment[][],
  translations: string[],
  options: { allowPartial?: boolean } = {},
) => {
  const expected = segmentMap.flatMap(segments => segments.flatMap(segment => segment.sentences)).length;
  if (translations.length > expected || (!options.allowPartial && translations.length !== expected)) throw new Error("Translation failed");
  let translationIndex = 0;

  return lines.map((line, index) => {
    const segments = segmentMap[index] ?? [];
    if (!segments.length) return line;

    let nextLine = line;
    const replacements = segments.map((segment) => {
      if (line.slice(segment.start, segment.end) !== segment.raw) throw new Error("Translation source changed");
      let sentenceOffset = 0;
      let replacement = "";
      for (const sentence of segment.sentences) {
        const sentenceStart = segment.raw.indexOf(sentence, sentenceOffset);
        const sentenceEnd = sentenceStart + sentence.length;
        const translated = translations[translationIndex]?.trim();
        translationIndex += 1;
        const usable = translated && isUsableLyricsTranslation(translated, sentence);
        if (!usable && !options.allowPartial) throw new Error("Translation failed");
        if (sentenceStart < sentenceOffset) throw new Error("Translation source changed");
        replacement += segment.raw.slice(sentenceOffset, sentenceEnd) + (usable ? ` (번역 : ${translated})` : "");
        sentenceOffset = sentenceEnd;
      }
      replacement += segment.raw.slice(sentenceOffset);
      return { start: segment.start, end: segment.end, replacement };
    });

    replacements
      .sort((a, b) => b.start - a.start)
      .forEach((segment) => {
        nextLine =
          nextLine.slice(0, segment.start) +
          segment.replacement +
          nextLine.slice(segment.end);
      });

    return nextLine;
  });
};

export class LyricsTranslationError extends Error {
  readonly translations: string[];
  readonly failedIndexes: number[];
  constructor(translations: string[], failedIndexes: number[], message = "자동번역을 완료하지 못한 구간이 있습니다. 일부 결과를 확인하고 다시 시도해주세요.") {
    super(message);this.name = "LyricsTranslationError";
    this.translations = translations;this.failedIndexes = failedIndexes;
  }
}

// Preserve the existing free browser route when the server provider cannot
// connect. Validation/rate-limit errors never take this path. No new provider
// origin, credentials, unbounded retry or whole-song URL is introduced.
async function translateWithGoogleInBrowser(text: string, source: string, target: string, signal: AbortSignal) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");url.searchParams.set("sl", source);url.searchParams.set("tl", target);url.searchParams.set("dt", "t");url.searchParams.set("q", text);
  for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
      const response = await withLyricsTranslationSignal(fetch(url.toString(), {method:"GET",cache:"no-store",signal:requestSignal}), requestSignal);
      if (!response.ok) { if (response.status === 429) return ""; continue; }
      const data = await withLyricsTranslationSignal(response.json(), requestSignal);
      if (!Array.isArray(data) || !Array.isArray(data[0]) || !data[0].length || !data[0].every((chunk:unknown)=>Array.isArray(chunk) && typeof chunk[0] === "string" && chunk[0].trim())) continue;
      const value = normalizeLyricsTranslation(data[0].map((chunk:string[])=>chunk[0]).join(""));
      if (isUsableLyricsTranslation(value, text, target)) return value;
    } catch { /* Only allowlisted metadata is logged by the server; no lyric URLs. */ }
  }
  return "";
}

export const requestLyricsTranslations = async (
  lines: string[],
  options: { source?: string; target?: string; signal?: AbortSignal; context?: string } = {},
): Promise<string[]> => {
  const source = options.source?.trim() || "auto";
  const target = options.target?.trim() || "ko";
  const empty = lines.map(() => "");
  if (lines.length > LYRICS_TRANSLATION_LIMITS.segments || lines.reduce((n, line) => n + line.length, 0) > LYRICS_TRANSLATION_LIMITS.total) {
    throw new LyricsTranslationError(empty, lines.flatMap((line, index) => line.trim() ? [index] : []), "가사가 한 번에 번역 가능한 범위를 넘었습니다. 가사를 나누어 번역해주세요.");
  }
  const prepared = lines.map(line => splitLyricsTranslationText(line));
  const unique = [...new Set(prepared.flat())];
  if (!unique.length) return empty;
  const results = new Map<string, string>();
  const deadline = AbortSignal.timeout(120_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const context = truncateLyricsContext(options.context ?? lines.join("\n"));
  const batches = lyricsTranslationBatches(unique, LYRICS_TRANSLATION_LIMITS.apiSegments, LYRICS_TRANSLATION_LIMITS.total);
  let nextBatch = 0;
  await Promise.allSettled(Array.from({length: Math.min(2, batches.length)}, async () => {
    while (nextBatch < batches.length && !signal.aborted) {
      let pending = batches[nextBatch++];
      for (let attempt = 0; attempt < 2 && pending.length && !signal.aborted; attempt++) {
        let retryable = true;
        let browserFallback = false;
        try {
          const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
          const response = await withLyricsTranslationSignal(fetch("/api/translate", {
            method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: requestSignal,
            body: JSON.stringify({lines: pending, source, target, context}),
          }), requestSignal);
          const payload = await withLyricsTranslationSignal(response.json(), requestSignal).catch(() => null);
          const values: unknown = payload?.translations;
          const validShape = Array.isArray(values) && values.length === pending.length && values.every(value => typeof value === "string");
          const partial = validShape && [502, 504].includes(response.status) && pending.some((text, index) => !isUsableLyricsTranslation(values[index], text, target));
          if (validShape && (response.ok || partial)) {
            pending.forEach((text, index) => {
              const value = normalizeLyricsTranslation(values[index]);
              if (isUsableLyricsTranslation(value, text, target)) results.set(text, value);
            });
          }
          retryable = response.ok || response.status >= 500;
          browserFallback = [502, 503].includes(response.status);
        } catch { browserFallback = !signal.aborted; }
        pending = pending.filter(text => !results.has(text));
        if (browserFallback && pending.length && !signal.aborted) {
          let nextText = 0;
          await Promise.allSettled(Array.from({length:Math.min(3,pending.length)},async()=>{
            while (nextText < pending.length && !signal.aborted) {
              const text = pending[nextText++];
              const value = await translateWithGoogleInBrowser(text,source,target,signal);
              if (value) results.set(text,value);
            }
          }));
          pending = pending.filter(text => !results.has(text));
        }
        if (!retryable) break;
      }
    }
  }));
  const translations = prepared.map(chunks => chunks.length && chunks.every(chunk => results.has(chunk)) ? chunks.map(chunk => results.get(chunk)!).join(" ") : "");
  const failedIndexes = lines.flatMap((line, index) => line.trim() && !isUsableLyricsTranslation(translations[index], line, target) ? [index] : []);
  if (failedIndexes.length || signal.aborted) throw new LyricsTranslationError(translations, failedIndexes);
  return translations;
};
