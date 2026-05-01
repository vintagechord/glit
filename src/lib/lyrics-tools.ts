const koreanLetterPattern = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const unicodeLetterPattern = /\p{L}/u;
const sentencePattern = /[^.!?。！？…]+[.!?。！？…]*/gu;
const translationMarkerPattern = /^[\s([{（]*번역\s*:/;
const maxTranslateChunkLength = 1200;

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

  if (!response.ok) return "";
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) return "";

  return data[0]
    .map((chunk: unknown) =>
      Array.isArray(chunk) && typeof chunk[0] === "string" ? chunk[0] : "",
    )
    .join("");
};

const translateBatchInBrowser = async (
  lines: string[],
  source: string,
  target: string,
) => {
  const translations: string[] = [];
  for (const line of lines) {
    const normalized = line.trim();
    translations.push(
      normalized ? await translateLineInBrowser(normalized, source, target) : "",
    );
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
    ? payload.translations
    : [];

  const apiTranslatedEveryLine =
    apiTranslations.length === lines.length &&
    lines.every((line, index) => !line.trim() || apiTranslations[index]?.trim());

  if (response.ok && apiTranslatedEveryLine) {
    return apiTranslations;
  }

  const fallbackTranslations = await translateBatchInBrowser(
    lines,
    source,
    target,
  );
  if (fallbackTranslations.some((line) => line.trim())) {
    return fallbackTranslations;
  }

  throw new Error(payload?.error ?? "Translation failed");
};
