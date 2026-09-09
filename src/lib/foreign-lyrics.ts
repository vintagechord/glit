const koreanLetter = /\p{Script=Hangul}/u;
const letter = /\p{L}/u;
const adlibToken = "(?:o+h+|o{2,}h*|a+h+|u+h+|hm+|la+|na+|ye+a+h+|he+y+|wo+a+h+|wo{2,}h*)";
const adlib = new RegExp(`^${adlibToken}(?:[\\s,!?.…\\-\\u2010-\\u2015]+${adlibToken})*[,!?.…]*$`, "i");

const koreanLetterNames = [
  "에이", "비", "시", "디", "이", "에프", "지", "에이치", "아이", "제이", "케이", "엘", "엠",
  "엔", "오", "피", "큐", "아르", "에스", "티", "유", "브이", "더블유", "엑스", "와이", "제트",
];

/** A last-resort reading of explicitly spelled letters, without guessing a name or meaning. */
export function translateSpelledOutLetters(value: string): string | null {
  const match = value.trim().match(/^([A-Z](?:[ \t]*[-\u2010-\u2015][ \t]*[A-Z]){2,})([,!?.…]*)$/);
  if (!match) return null;
  const letters = match[1].match(/[A-Z]/g)!;
  return letters.map((letter) => koreanLetterNames[letter.charCodeAt(0) - 65]).join(" ") + match[2];
}

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
