import { translateLyricsWithOpenAI } from "./openai-translation";
import { translateSpelledOutLetters } from "./foreign-lyrics";

import { isUsableLyricsTranslation, normalizeLyricsTranslation, splitLyricsTranslationText, lyricsTranslationModelBatches, truncateLyricsContext, hasForeignLyricsLetters, withLyricsTranslationSignal } from "./lyrics-translation-validation";
export { isUsableLyricsTranslation } from "./lyrics-translation-validation";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const translateConcurrency = 3;
const lingvaTranslateOrigins = ["https://lingva.ml"];

type TranslationProviderName = "openai" | "google" | "lingva";
type FreeProviderName = Exclude<TranslationProviderName, "openai">;
type TranslationFailureCategory = "http" | "network" | "timeout" | "aborted" | "invalid_response" | "not_configured" | "unknown";

class TranslationProviderError extends Error {
  constructor(readonly category: TranslationFailureCategory, readonly status?: number) {
    super(category);
  }
}

/** Log only allowlisted metadata: fetch errors and response bodies can contain lyrics or credentials. */
const logTranslationProviderFailure = (provider: TranslationProviderName, error: unknown) => {
  let category: TranslationFailureCategory = "unknown";
  let status: number | undefined;
  if (error instanceof TranslationProviderError) {
    category = error.category;
    status = error.status;
  } else if (error instanceof Error) {
    // The OpenAI adapter exposes its HTTP status in this fixed, locally authored message.
    const openAIStatus = provider === "openai"
      ? /^OpenAI translation request failed \(([1-5]\d{2})\)$/.exec(error.message)
      : null;
    if (openAIStatus) { category = "http"; status = Number(openAIStatus[1]); }
    else if (error.name === "TimeoutError") category = "timeout";
    else if (error.name === "AbortError") category = "aborted";
    else if (error instanceof TypeError) category = "network";
    else if (error instanceof SyntaxError || (provider === "openai" && [
      "OpenAI translation returned empty output",
      "OpenAI translation response is missing translations",
      "OpenAI translation count mismatch",
    ].includes(error.message))) category = "invalid_response";
  }
  console.error("[translate] provider failed", {
    provider,
    category,
    ...(Number.isInteger(status) && status! >= 100 && status! <= 599 ? { status } : {}),
  });
};

/**
 * A rate limit (429) or a block (403) is an answer to this server, not to one
 * lyric line: the next line would be refused as well. In production the free
 * Google route refused every request on 2026-11-16 and 11-19 and each line of
 * a song was still sent to both free providers twice, so a request made
 * hundreds of calls that could not succeed before it reported the failure.
 * A provider that refuses is therefore left out for the rest of the request.
 */
const isProviderRefusal = (error: unknown) =>
  error instanceof TranslationProviderError &&
  error.category === "http" &&
  (error.status === 429 || error.status === 403);

const normalizeLanguageCode = (value: string, fallback: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "auto") return "auto";
  return /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(normalized)
    ? normalized
    : fallback;
};

const normalizeTranslationOutput = normalizeLyricsTranslation;

const baseLanguageCode = (value: string) =>
  value === "auto" ? value : value.split("-")[0] || value;

const splitTextForTranslation = splitLyricsTranslationText;

const translateLineWithGoogle = async (
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
) => {
  if (!text.trim()) return "";
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; ONSIDE-Translate/1.0; +https://onside17.com)",
    },
  });

  if (!response.ok) {
    throw new TranslationProviderError("http", response.status);
  }

  const data = (await response.json().catch(() => {
    throw new TranslationProviderError("invalid_response", response.status);
  })) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new TranslationProviderError("invalid_response", response.status);
  }
  return normalizeTranslationOutput(
    data[0]
      .map((chunk: unknown) =>
        Array.isArray(chunk) && typeof chunk[0] === "string" ? chunk[0] : "",
      )
      .join(""),
  );
};

const translateLineWithLingva = async (
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
) => {
  if (!text.trim()) return "";
  const sourceCode = baseLanguageCode(source);
  const targetCode = baseLanguageCode(target);

  let failure: unknown = null;
  for (const origin of lingvaTranslateOrigins) {
    const url = `${origin}/api/v1/${encodeURIComponent(sourceCode)}/${encodeURIComponent(targetCode)}/${encodeURIComponent(text)}`;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: {
          Accept: "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; ONSIDE-Translate/1.0; +https://onside17.com)",
        },
      });

      if (!response.ok) throw new TranslationProviderError("http", response.status);
      const data = (await response.json().catch(() => {
        throw new TranslationProviderError("invalid_response", response.status);
      })) as unknown;
      const translation =
        data &&
        typeof data === "object" &&
        "translation" in data &&
        typeof data.translation === "string"
          ? data.translation
          : "";
      const normalized = normalizeTranslationOutput(translation);
      if (normalized) return normalized;
      throw new TranslationProviderError("invalid_response", response.status);
    } catch (error) {
      failure = error;
    }
  }

  // The caller reports the failure and decides whether to ask again.
  if (failure) throw failure;
  return "";
};

const freeProviders = [
  { name: "google", translate: translateLineWithGoogle },
  { name: "lingva", translate: translateLineWithLingva },
] as const;

const anyProviderLeft = (refused: ReadonlySet<FreeProviderName>) =>
  freeProviders.some((provider) => !refused.has(provider.name));

const translateLineOnce = async (
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
  refused: Set<FreeProviderName>,
) => {
  for (const provider of freeProviders) {
    if (refused.has(provider.name)) continue;
    try {
      const translated = await provider.translate(text, source, target, fetchImpl);
      if (isUsableLyricsTranslation(translated, text, target)) return translated;
    } catch (error) {
      if (isProviderRefusal(error)) refused.add(provider.name);
      logTranslationProviderFailure(provider.name, error);
    }
  }

  // Providers commonly echo names sung letter by letter. Preserve the original
  // lyrics and supply the Korean letter names instead of failing the whole ZIP.
  // Ordinary words and sentences still require a successful semantic translation.
  return baseLanguageCode(target) === "ko" ? translateSpelledOutLetters(text) ?? "" : "";
};

const translateLine = async (
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
  refused: Set<FreeProviderName>,
) => {
  const chunks = splitTextForTranslation(text);
  if (chunks.length > 1) {
    const translations: string[] = [];
    for (const chunk of chunks) {
      const translated = await translateLine(chunk, source, target, fetchImpl, refused);
      if (!translated.trim()) return "";
      translations.push(translated.trim());
    }
    return translations.join(" ");
  }

  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // With every provider refusing, only the local reading of spelled-out
    // letters is left: nothing was asked, so nothing is reported or retried.
    const asked = anyProviderLeft(refused);
    try {
      const translated = await translateLineOnce(text, source, target, fetchImpl, refused);
      if (isUsableLyricsTranslation(translated, text, target)) return translated;
      throw new Error("Translation providers returned empty results");
    } catch {
      if (!asked) return "";
      console.error(
        "[translate] failed attempt",
        attempt,
        "length",
        text.length,
      );
      if (attempt === maxAttempts || !anyProviderLeft(refused)) {
        return "";
      }
      await sleep(200 * attempt);
    }
  }
  return "";
};

export const translateLyricsBatch = async (
  lines: string[],
  options: { source?: string; target?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; context?: string; timeoutMs?: number } = {},
) => {
  options.signal?.throwIfAborted();
  const source = normalizeLanguageCode(options.source ?? "auto", "auto");
  const target = normalizeLanguageCode(options.target ?? "ko", "ko");
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 55_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const fetchImpl: typeof fetch = (input, init) => {
    signal.throwIfAborted();
    const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    return withLyricsTranslationSignal((options.fetchImpl ?? fetch)(input, { ...init, signal: requestSignal }), requestSignal);
  };
  const prepared = lines.map(line => ({ source: line.trim(), chunks: splitLyricsTranslationText(line) }));
  // The same calls /api/translate charges against its limits.
  const batches = lyricsTranslationModelBatches(lines, target);
  const uniqueTexts = batches.flat();
  const translations = new Map<string, string>();
  const context = truncateLyricsContext(options.context ?? lines.join("\n"));
  let nextBatch = 0;
  let reportedMissingKey = false;
  await Promise.allSettled(Array.from({ length: Math.min(2, batches.length) }, async () => {
    while (nextBatch < batches.length && !signal.aborted) {
      const batch = batches[nextBatch++];
      try {
        const result = await translateLyricsWithOpenAI(batch, { source, target, fetchImpl, signal, context });
        if (!result && !reportedMissingKey) { reportedMissingKey = true; logTranslationProviderFailure("openai", new TranslationProviderError("not_configured")); }
        result?.forEach((value, index) => {
          const normalized = normalizeTranslationOutput(value);
          if (isUsableLyricsTranslation(normalized, batch[index], target)) translations.set(batch[index], normalized);
        });
      } catch (error) { logTranslationProviderFailure("openai", error); }
    }
  }));
  const missing = uniqueTexts.filter(text => !translations.has(text));
  const refused = new Set<FreeProviderName>();
  let nextText = 0;
  await Promise.allSettled(Array.from({ length: Math.min(translateConcurrency, missing.length) }, async () => {
    while (nextText < missing.length && !signal.aborted) {
      const text = missing[nextText++];
      try {
        const translated = await withLyricsTranslationSignal(translateLine(text, source, target, fetchImpl, refused), signal);
        if (isUsableLyricsTranslation(translated, text, target)) translations.set(text, translated);
      } catch { /* Retain completed results; an aborted segment is never success. */ }
    }
  }));
  return prepared.map(line => {
    if (!line.source) return "";
    if (target.split("-")[0] === "ko" && !hasForeignLyricsLetters(line.source)) return line.source;
    // A partially translated long excerpt must never look like a complete one.
    if (!line.chunks.every(chunk => translations.has(chunk))) return "";
    const value = line.chunks.map(chunk => translations.get(chunk)!).join(" ");
    return isUsableLyricsTranslation(value, line.source, target) ? value : "";
  });
};
