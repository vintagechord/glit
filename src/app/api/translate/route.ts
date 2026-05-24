import { NextResponse } from "next/server";

type TranslateRequest = {
  lines?: string[];
  source?: string;
  target?: string;
};

export const runtime = "nodejs";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const maxTranslateChunkLength = 1200;
const maxTranslateLines = 120;
const maxTranslateLineLength = 5000;
const translateConcurrency = 3;

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

const translateLineOnce = async (
  text: string,
  source: string,
  target: string,
) => {
  if (!text.trim()) return "";
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
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

const translateLine = async (
  text: string,
  source: string,
  target: string,
) => {
  const chunks = splitTextForTranslation(text);
  if (chunks.length > 1) {
    const translations: string[] = [];
    for (const chunk of chunks) {
      const translated = await translateLine(chunk, source, target);
      if (translated.trim()) {
        translations.push(translated.trim());
      }
    }
    return translations.join(" ");
  }

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await translateLineOnce(text, source, target);
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      console.error(
        "[translate] failed attempt",
        attempt,
        "length",
        text.length,
        error,
      );
      if (isLastAttempt) {
        return "";
      }
      await sleep(200 * attempt);
    }
  }
  return "";
};

const translateBatch = async (
  lines: string[],
  source: string,
  target: string,
) => {
  const normalizedCache = new Map<string, string>();
  const uniqueTexts: string[] = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || normalizedCache.has(normalized)) continue;
    normalizedCache.set(normalized, "");
    uniqueTexts.push(normalized);
  }

  if (uniqueTexts.length > 0) {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(translateConcurrency, uniqueTexts.length) },
      async () => {
        while (nextIndex < uniqueTexts.length) {
          const text = uniqueTexts[nextIndex];
          nextIndex += 1;
          const translated = await translateLine(text, source, target);
          normalizedCache.set(text, translated);
        }
      },
    );
    await Promise.all(workers);
  }

  return lines.map((line) => {
    const normalized = line.trim();
    if (!normalized) return "";
    return normalizedCache.get(normalized) ?? "";
  });
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TranslateRequest;
    const lines = Array.isArray(body.lines)
      ? body.lines
          .slice(0, maxTranslateLines)
          .map((line) => String(line ?? "").slice(0, maxTranslateLineLength))
      : [];
    if (!lines.length) {
      return NextResponse.json({ translations: [] });
    }

    const source =
      typeof body.source === "string" && body.source.trim()
        ? normalizeLanguageCode(body.source, "auto")
        : "auto";
    const target =
      typeof body.target === "string" && body.target.trim()
        ? normalizeLanguageCode(body.target, "ko")
        : "ko";

    const translations = await translateBatch(lines, source, target);
    const requestedCount = lines.filter((line) => line.trim()).length;
    const translatedCount = translations.filter((line) => line.trim()).length;

    if (requestedCount > 0 && translatedCount === 0) {
      return NextResponse.json(
        { error: "Translation provider returned no results" },
        { status: 502 },
      );
    }

    return NextResponse.json({ translations });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 },
    );
  }
}
