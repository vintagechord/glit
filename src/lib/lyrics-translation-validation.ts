import { analyzeLyricsProfanity } from "./profanity/lyrics";

// Shared, browser-safe checks. These reject structural failures and obvious
// censorship; semantic accuracy still requires the applicant's review.
export const LYRICS_TRANSLATION_LIMITS = { total: 60_000, segments: 2400, apiSegments: 120, apiLine: 5000, context: 12_000, chunk: 1200, batch: 20, batchCharacters: 4000 } as const;

export const normalizeLyricsTranslation = (value: string) => value.replace(/\s+/g, " ").replace(/^\s*번역\s*[:：]\s*/i, "").trim();
export const hasForeignLyricsLetters = (value: string) => [...value].some(char => /\p{L}/u.test(char) && !/\p{Script=Hangul}/u.test(char));
const comparable = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");

export function isUsableLyricsTranslation(translation: string, source: string, target = "ko") {
  const value = normalizeLyricsTranslation(translation);
  if (!value || /^(?:TODO|번역문|번역\s*실패|번역\s*불가|translation|\.{2,}|…+)$/i.test(value)) return false;
  if (/^(?:죄송하지만|번역을 제공할 수 없|이 내용은 번역할 수 없|I (?:cannot|can't|am unable to) translate)/i.test(value)) return false;
  if (value.length > Math.max(300, source.length * 12)) return false;
  if (target.split("-")[0] !== "ko") return comparable(value) !== comparable(source);
  if (!hasForeignLyricsLetters(source)) return /[가-힣]/.test(value) || comparable(value) === comparable(source);
  if (!/[가-힣]/.test(value) || comparable(value) === comparable(source)) return false;
  const explicit = /\b(?:motherfuck\w*|fuck\w*|shit(?:ty|s|ting)?|bullshit|bitch(?:es)?|assholes?|cunts?)\b/i.test(source)
    || analyzeLyricsProfanity(source).matches.some(match => match.category === "confident" && match.language === "en");
  if (explicit) {
    // An uncensored vulgar original must not silently become a polite sentence
    // or a censor label. This is intentionally a narrow English safeguard.
    if (/(?:\*{2,}|\[(?:욕설|비속어|검열|삭제)\]|삐[ -]?처리|욕설 생략)/i.test(value)) return false;
    if (!/(?:씨발|시발|씨팔|씹|좆|존나|개새끼|새끼|개자식|개같|병신|지랄|썅|년|똥|젠장|빌어먹|엿|항문|보지|개쩔|쩔어|창녀|걸레|사생아)/.test(value)) return false;
  }
  return true;
}

export function truncateLyricsContext(value: string) {
  let end = Math.min(value.length, LYRICS_TRANSLATION_LIMITS.context);
  if (/[\uD800-\uDBFF]/.test(value[end - 1] ?? "")) end -= 1;
  return value.slice(0, end);
}

export function splitLyricsTranslationText(value: string, limit = LYRICS_TRANSLATION_LIMITS.chunk) {
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > limit) {
    const sample = remaining.slice(0, limit);
    const space = Math.max(sample.lastIndexOf(" "), sample.lastIndexOf("\n"));
    let end = space > limit * .45 ? space + 1 : limit;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end -= 1;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function lyricsTranslationBatches(texts: string[], maxCount: number = LYRICS_TRANSLATION_LIMITS.batch, maxCharacters: number = LYRICS_TRANSLATION_LIMITS.batchCharacters) {
  const batches: string[][] = [];
  for (const text of texts) {
    let batch = batches.at(-1);
    if (!batch || batch.length >= maxCount || batch.reduce((n, s) => n + s.length, 0) + text.length > maxCharacters) { batch = []; batches.push(batch); }
    batch.push(text);
  }
  return batches;
}

/** A mock or stalled response body must obey the same cancellation as fetch. */
export function withLyricsTranslationSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    if (signal.aborted) { work.catch(() => undefined); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
