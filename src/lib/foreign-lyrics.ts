const koreanLetter = /\p{Script=Hangul}/u;
const letter = /\p{L}/u;
const adlib = /^(?:oh|ooh|ah|aah|uh|hmm|la|na|yeah|hey|woah|woo)(?:[\s,!?.]+(?:oh|ooh|ah|aah|uh|hmm|la|na|yeah|hey|woah|woo))*[,!?.]*$/i;

/** Keep existing Korean annotations intact, including the older UI's marker. */
export function inlineLyricTranslation(value: string) {
  const explicit = value.match(/^[ \t]*(?:\(|（|\[|\{)?[ \t]*(?:번역|해석)[ \t]*[:：][ \t]*([^\n\r)）\]}]+)[)）\]}]?/);
  const parenthesized = value.match(/^[ \t]*[（(]([가-힣][^\n\r()（）]*)[)）]/);
  const match = explicit ?? parenthesized;
  if (!match || !/[가-힣]/.test(match[1])) return null;
  return { text: match[0], translation: match[1].trim() };
}

export type ForeignLyricsSpan = { start: number; end: number; source: string; language: "en" | "ja" | "other" };

/** Unicode letters cover Cyrillic, Arabic, Thai, accented Latin, CJK and mixed lyrics. */
export function findForeignLyricsSpans(lyrics: string): ForeignLyricsSpan[] {
  const spans: ForeignLyricsSpan[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const source = lyrics.slice(start, end).trimEnd();
    if (source && !adlib.test(source)) {
      spans.push({
        start, end: start + source.length, source,
        language: /[\u3040-\u30ff]/.test(source) ? "ja" : /^[\x00-\x7f]*$/.test(source) ? "en" : "other",
      });
    }
    start = -1;
  };
  for (let index = 0; index < lyrics.length;) {
    const char = String.fromCodePoint(lyrics.codePointAt(index)!);
    const annotation = /[（([\{번해]/.test(char) ? inlineLyricTranslation(lyrics.slice(index)) : null;
    if (annotation) {
      flush(index);
      index += annotation.text.length;
      continue;
    }
    if (koreanLetter.test(char) || char === "\n" || char === "\r") flush(index);
    else if (start < 0 && letter.test(char)) start = index;
    index += char.length;
  }
  flush(lyrics.length);
  return spans;
}
