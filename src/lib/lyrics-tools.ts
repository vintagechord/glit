const koreanLetterPattern = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const unicodeLetterPattern = /\p{L}/u;
const sentencePattern = /[^.!?。！？…]+[.!?。！？…]*/gu;
const translationMarkerPattern = /^[\s([{（]*번역\s*:/;
const maxTranslateChunkLength = 1200;
const browserTranslationRetryCount = 2;
const lingvaTranslateOrigins = ["https://lingva.ml"];

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

const isForeignLetter = (char: string) =>
  unicodeLetterPattern.test(char) && !koreanLetterPattern.test(char);

export const extractForeignSegments = (
  line: string,
): ForeignLyricSegment[] => {
  const segments: ForeignLyricSegment[] = [];
  let start = -1;
  let hasForeign = false;

  const pushSegment = (end: number) => {
    if (start < 0) return;
    const raw = line.slice(start, end);
    const trimmed = raw.trim();
    const alreadyTranslated =
      trimmed.includes("번역:") ||
      translationMarkerPattern.test(line.slice(end));

    if (!hasForeign || !trimmed || alreadyTranslated) {
      start = -1;
      hasForeign = false;
      return;
    }

    const sentences = splitForeignSentences(trimmed);
    if (sentences.length > 0) {
      segments.push({
        raw,
        start,
        end,
        sentences,
      });
    }
    start = -1;
    hasForeign = false;
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const isKorean = koreanLetterPattern.test(char);
    if (isKorean) {
      pushSegment(index);
      continue;
    }
    if (start < 0 && isForeignLetter(char)) {
      start = index;
    }
    if (start >= 0 && isForeignLetter(char)) {
      hasForeign = true;
    }
  }

  pushSegment(line.length);
  return segments;
};

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
) => {
  let translationIndex = 0;

  return lines.map((line, index) => {
    const segments = segmentMap[index] ?? [];
    if (!segments.length) return line;

    let nextLine = line;
    const replacements = segments.map((segment) => {
      const translatedSentences = segment.sentences.map((sentence) => {
        const translation = translations[translationIndex] ?? "";
        translationIndex += 1;
        const translated = translation.trim() || "번역 실패";
        return `${sentence} (번역: ${translated})`;
      });
      const leading = segment.raw.match(/^\s*/)?.[0] ?? "";
      const trailing = segment.raw.match(/\s*$/)?.[0] ?? "";

      return {
        start: segment.start,
        end: segment.end,
        replacement: `${leading}${translatedSentences.join(" ")}${trailing}`,
      };
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
    const end =
      breakIndex > maxTranslateChunkLength * 0.45
        ? breakIndex + 1
        : maxTranslateChunkLength;
    const chunk = remaining.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

const normalizeTranslationOutput = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^\s*번역\s*:\s*/i, "")
    .trim();

const baseLanguageCode = (value: string) =>
  value === "auto" ? value : value.split("-")[0] || value;

const translateLineWithGoogleInBrowser = async (
  text: string,
  source: string,
  target: string,
) => {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  for (let attempt = 1; attempt <= browserTranslationRetryCount; attempt += 1) {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
    }).catch(() => null);

    if (!response?.ok) {
      if (attempt === browserTranslationRetryCount) return "";
      continue;
    }
    const data = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return "";

    return normalizeTranslationOutput(
      data[0]
        .map((chunk: unknown) =>
          Array.isArray(chunk) && typeof chunk[0] === "string" ? chunk[0] : "",
        )
        .join(""),
    );
  }

  return "";
};

const translateLineWithLingvaInBrowser = async (
  text: string,
  source: string,
  target: string,
) => {
  const sourceCode = baseLanguageCode(source);
  const targetCode = baseLanguageCode(target);

  for (const origin of lingvaTranslateOrigins) {
    const url = `${origin}/api/v1/${encodeURIComponent(sourceCode)}/${encodeURIComponent(targetCode)}/${encodeURIComponent(text)}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
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

const translateLineInBrowser = async (
  text: string,
  source: string,
  target: string,
): Promise<string> => {
  const chunks = splitTextForTranslation(text);
  if (chunks.length > 1) {
    const translatedChunks: string[] = [];
    for (const chunk of chunks) {
      const translated = await translateLineInBrowser(chunk, source, target);
      if (translated.trim()) translatedChunks.push(translated.trim());
    }
    return translatedChunks.join(" ");
  }

  for (let attempt = 1; attempt <= browserTranslationRetryCount; attempt += 1) {
    const googleTranslation = await translateLineWithGoogleInBrowser(
      text,
      source,
      target,
    );
    if (googleTranslation.trim()) return googleTranslation;

    const fallbackTranslation = await translateLineWithLingvaInBrowser(
      text,
      source,
      target,
    );
    if (fallbackTranslation.trim()) return fallbackTranslation;
  }

  return "";
};

const translateBatchInBrowser = async (
  lines: string[],
  source: string,
  target: string,
) => {
  const cache = new Map<string, string>();
  const translations: string[] = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) {
      translations.push("");
      continue;
    }
    if (!cache.has(normalized)) {
      cache.set(
        normalized,
        await translateLineInBrowser(normalized, source, target),
      );
    }
    translations.push(cache.get(normalized) ?? "");
  }
  return translations;
};

export const requestLyricsTranslations = async (
  lines: string[],
  options?: { source?: string; target?: string },
) => {
  const source = options?.source?.trim() || "auto";
  const target = options?.target?.trim() || "ko";

  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lines, source, target }),
  });
  const payload = await response.json().catch(() => null);
  const apiTranslations: string[] = Array.isArray(payload?.translations)
    ? payload.translations.map((line: unknown) =>
        typeof line === "string" ? normalizeTranslationOutput(line) : "",
      )
    : [];

  const apiTranslatedEveryLine =
    apiTranslations.length === lines.length &&
    lines.every((line, index) => !line.trim() || apiTranslations[index]?.trim());

  if (response.ok && apiTranslatedEveryLine) {
    return apiTranslations;
  }

  const missingIndexes = lines
    .map((line, index) =>
      line.trim() && !apiTranslations[index]?.trim() ? index : -1,
    )
    .filter((index) => index >= 0);
  const fallbackTranslations = missingIndexes.length
    ? await translateBatchInBrowser(
        missingIndexes.map((index) => lines[index]),
        source,
        target,
      )
    : [];

  const mergedTranslations = [...apiTranslations];
  missingIndexes.forEach((lineIndex, fallbackIndex) => {
    mergedTranslations[lineIndex] =
      normalizeTranslationOutput(fallbackTranslations[fallbackIndex] ?? "") ||
      mergedTranslations[lineIndex] ||
      "";
  });

  if (
    mergedTranslations.length === lines.length &&
    lines.every((line, index) => !line.trim() || mergedTranslations[index]?.trim())
  ) {
    return mergedTranslations;
  }

  throw new Error(payload?.error ?? "Translation failed");
};
