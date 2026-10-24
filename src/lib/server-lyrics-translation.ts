import { translateLyricsWithOpenAI } from "./openai-translation";
import { translateSpelledOutLetters } from "./foreign-lyrics";

import { isUsableLyricsTranslation, normalizeLyricsTranslation, splitLyricsTranslationText, lyricsTranslationBatches, truncateLyricsContext, hasForeignLyricsLetters, withLyricsTranslationSignal } from "./lyrics-translation-validation";
export { isUsableLyricsTranslation } from "./lyrics-translation-validation";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const translateConcurrency = 3;
const lingvaTranslateOrigins = ["https://lingva.ml"];

type TranslationProviderName = "openai" | "google" | "lingva";
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
      logTranslationProviderFailure("lingva", error);
    }
  }

  return "";
};

const translateLineOnce = async (
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
) => {
  const providers = [
    { name: "google", translate: translateLineWithGoogle },
    { name: "lingva", translate: translateLineWithLingva },
  ] as const;

  for (const provider of providers) {
    try {
      const translated = await provider.translate(text, source, target, fetchImpl);
      if (isUsableLyricsTranslation(translated, text, target)) return translated;
    } catch (error) {
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
) => {
  const chunks = splitTextForTranslation(text);
  if (chunks.length > 1) {
    const translations: string[] = [];
    for (const chunk of chunks) {
      const translated = await translateLine(chunk, source, target, fetchImpl);
      if (!translated.trim()) return "";
      translations.push(translated.trim());
    }
    return translations.join(" ");
  }

  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const translated = await translateLineOnce(text, source, target, fetchImpl);
      if (isUsableLyricsTranslation(translated, text, target)) return translated;
      throw new Error("Translation providers returned empty results");
    } catch {
      const isLastAttempt = attempt === maxAttempts;
      console.error(
        "[translate] failed attempt",
        attempt,
        "length",
        text.length,
      );
      if (isLastAttempt) {
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
  const uniqueTexts = [...new Set(prepared.filter(line => !(target.split("-")[0] === "ko" && !hasForeignLyricsLetters(line.source))).flatMap(line => line.chunks))];
  const translations = new Map<string, string>();
  const context = truncateLyricsContext(options.context ?? lines.join("\n"));
  const batches = lyricsTranslationBatches(uniqueTexts);
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
  let nextText = 0;
  await Promise.allSettled(Array.from({ length: Math.min(translateConcurrency, missing.length) }, async () => {
    while (nextText < missing.length && !signal.aborted) {
      const text = missing[nextText++];
      try {
        const translated = await withLyricsTranslationSignal(translateLine(text, source, target, fetchImpl), signal);
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
