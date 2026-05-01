const koreanLetterPattern = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const unicodeLetterPattern = /\p{L}/u;
const sentencePattern = /[^.!?。！？…]+[.!?。！？…]*/gu;
const translationMarkerPattern = /^[\s([{（]*번역\s*:/;

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
