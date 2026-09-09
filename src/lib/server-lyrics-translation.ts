import { translateLyricsWithOpenAI } from "./openai-translation";

/** A nonempty response is not enough: untranslated source text must not pass as Korean. */
export const isUsableLyricsTranslation = (translation: string, source: string, target = "ko") => {
  const value = translation.trim();
  if (!value || /^(?:TODO|번역문|번역 실패|translation)$/i.test(value)) return false;
  return target.split("-")[0] !== "ko" || (/[가-힣]/.test(value) && value !== source.trim());
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const maxTranslateChunkLength = 1200;
const translateConcurrency = 3;
const lingvaTranslateOrigins = ["https://lingva.ml"];

const normalizeLanguageCode = (value: string, fallback: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "auto") return "auto";
  return /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(normalized)
    ? normalized
    : fallback;
};

const normalizeTranslationOutput = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^\s*번역\s*:\s*/i, "")
    .trim();

const baseLanguageCode = (value: string) =>
  value === "auto" ? value : value.split("-")[0] || value;

const splitTextForTranslation = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length <= maxTranslateChunkLength) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxTranslateChunkLength) {
    const slice = remaining.slice(0, maxTranslateChunkLength);
    const breakIndex = Math.max(
      slice.lastIndexOf("\n"),
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf(", "),
      slice.lastIndexOf(" "),
    );
    const end = breakIndex > maxTranslateChunkLength * 0.45
      ? breakIndex + 1
      : maxTranslateChunkLength;
    const chunk = remaining.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

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
    throw new Error("Translation request failed");
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
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
    }).catch(() => null);

    if (!response?.ok) continue;
    const data = (await response.json().catch(() => null)) as unknown;
    const translation =
      data &&
      typeof data === "object" &&
      "translation" in data &&
      typeof data.translation === "string"
        ? data.translation
        : "";
    const normalized = normalizeTranslationOutput(translation);
    if (normalized) return normalized;
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
  ];

  for (const provider of providers) {
    try {
      const translated = await provider.translate(text, source, target, fetchImpl);
      if (isUsableLyricsTranslation(translated, text, target)) return translated;
    } catch {
      console.error("[translate] provider failed", provider.name);
    }
  }

  return "";
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
  options: { source?: string; target?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) => {
  const source = normalizeLanguageCode(options.source ?? "auto", "auto");
  const target = normalizeLanguageCode(options.target ?? "ko", "ko");
  const signal = options.signal ?? AbortSignal.timeout(55_000);
  const fetchImpl: typeof fetch = (input, init) => {
    signal.throwIfAborted();
    return (options.fetchImpl ?? fetch)(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
  };
  const normalizedCache = new Map<string, string>();
  const uniqueTexts: string[] = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || normalizedCache.has(normalized)) continue;
    normalizedCache.set(normalized, "");
    uniqueTexts.push(normalized);
  }

  if (uniqueTexts.length > 0) {
    try {
      const openAITranslations = await translateLyricsWithOpenAI(uniqueTexts, {
        source,
        target,
        fetchImpl,
      });
      openAITranslations?.forEach((translation, index) => {
        const text = uniqueTexts[index];
        if (!text) return;
        const normalized = normalizeTranslationOutput(translation);
        if (isUsableLyricsTranslation(normalized, text, target)) normalizedCache.set(text, normalized);
      });
    } catch {
      console.error("[translate] openai provider failed");
    }

    const fallbackTexts = uniqueTexts.filter(
      (text) => !normalizedCache.get(text)?.trim(),
    );
    if (fallbackTexts.length > 0) {
      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(translateConcurrency, fallbackTexts.length) },
        async () => {
          while (nextIndex < fallbackTexts.length) {
            signal.throwIfAborted();
            const text = fallbackTexts[nextIndex];
            nextIndex += 1;
            const translated = await translateLine(text, source, target, fetchImpl);
            normalizedCache.set(text, translated);
          }
        },
      );
      await Promise.all(workers);
    }
  }

  return lines.map((line) => {
    const normalized = line.trim();
    if (!normalized) return "";
    return normalizedCache.get(normalized) ?? "";
  });
};
