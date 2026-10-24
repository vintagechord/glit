import dictionary from "../../../config/profanity_lyrics.json";
import type { ProfanityTerm } from "./legacy";

export type LyricsProfanityCategory = "confident" | "suspected";
export type LyricsProfanityMatch = {
  /** UTF-16 offsets into the unchanged input; end is exclusive. */
  start: number;
  end: number;
  matchedText: string;
  term: string;
  ruleId: string;
  reason: string;
  category: LyricsProfanityCategory;
  language: "ko" | "en" | "mixed";
};
export type LyricsProfanityAnalysis = {
  hasProfanity: boolean;
  hasSuspectedProfanity: boolean;
  matches: LyricsProfanityMatch[];
  /** Incomplete analysis must never be presented as a clean result. */
  truncated: boolean;
  analyzedLength: number;
  sourceLength: number;
};

export const LYRICS_PROFANITY_LIMITS = {
  textLength: 100_000,
  matches: 1_000,
  extraTerms: 256,
  termLength: 128,
} as const;

type MappedText = { text: string; starts: number[]; ends: number[] };
type SearchText = { text: string; first: number[]; last: number[] };
type Channel = "ko" | "en" | "masked";
type LyricsRule = {
  id: string;
  term: string;
  variants: string[];
  language: "ko" | "en" | "mixed";
  category: LyricsProfanityCategory;
  reason?: string;
  boundary?: "word";
  masked?: boolean;
};
type CompiledLyricsRule = LyricsRule & { needles: string[]; termsByNeedle: Map<string, string>; channel: Channel };
const lead = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const vowels = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const tail = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const ignorable = /[\p{Default_Ignorable_Code_Point}\p{M}\p{Cc}]/u;
const separator = /[\p{White_Space}\p{P}\p{S}]/u;
const word = /[\p{L}\p{N}]/u;
const englishWord = /[\p{Script=Latin}\p{N}]/u;
const asciiLetter = /^[a-z]$/;
const leet: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
const confusables: Record<string, string> = { "а": "a", "с": "c", "е": "e", "і": "i", "к": "k", "о": "o", "р": "p", "ѕ": "s", "т": "t", "х": "x", "υ": "u" };
const reasonText: Record<string, string> = {
  dictionary: "욕설 사전의 표현 또는 우회 표기와 일치합니다.",
  phonetic: "욕설과 발음이 비슷한 표현입니다. 문맥을 확인해주세요.",
  ambiguous: "다른 뜻으로도 쓰이는 표현입니다. 문맥을 확인해주세요.",
  initials: "욕설의 초성 표기로 쓰일 수 있습니다. 문맥을 확인해주세요.",
  masked: "일부 글자를 가린 욕설 표기와 일치합니다.",
  custom: "관리자가 등록한 확인 대상 표현과 일치합니다.",
};

const compatible = (character: string) => {
  const code = character.codePointAt(0)!;
  if (code >= 0x1100 && code < 0x1100 + lead.length) return lead[code - 0x1100];
  if (code >= 0x1161 && code < 0x1161 + vowels.length) return vowels[code - 0x1161];
  if (code > 0x11a7 && code < 0x11a7 + tail.length) return tail[code - 0x11a7];
  return confusables[character] ?? character;
};

/** Each expansion/compression retains the entire original code-point range. */
const mapText = (source: string): Record<Channel, MappedText> => {
  const channels: Record<Channel, MappedText> = {
    ko: { text: "", starts: [], ends: [] },
    en: { text: "", starts: [], ends: [] },
    masked: { text: "", starts: [], ends: [] },
  };
  const buffers: Record<Channel, string[]> = { ko: [], en: [], masked: [] };
  const append = (channel: Channel, value: string, start: number, end: number) => {
    const mapped = channels[channel];
    const buffer = buffers[channel];
    const last = buffer.length - 1;
    if (channel !== "ko" && asciiLetter.test(value) && buffer[last] === value && mapped.ends[last] === start) {
      mapped.ends[last] = end;
      return;
    }
    // NFKD emits individual code points; supplementary letters stay barriers.
    for (let unit = 0; unit < value.length; unit++) {
      buffer.push(value[unit]);
      mapped.starts.push(start);
      mapped.ends.push(end);
    }
  };
  let offset = 0;
  for (const original of source) {
    const start = offset;
    offset += original.length;
    for (const part of original.normalize("NFKD").toLowerCase()) {
      const character = compatible(part);
      if (ignorable.test(character)) continue;
      const symbolLeet = (character === "@" || character === "$" || character === "!") && /[a-z]/i.test(source[offset] ?? "");
      if (separator.test(character)) {
        if (symbolLeet) {
          append("en", leet[character], start, offset);
          append("masked", leet[character], start, offset);
        } else if (/^[*#?_]$/.test(character)) append("masked", "*", start, offset);
        continue;
      }
      if (!/\p{N}/u.test(character)) append("ko", character, start, offset);
      append("en", leet[character] ?? character, start, offset);
      append("masked", leet[character] ?? character, start, offset);
    }
  }
  for (const channel of ["ko", "en", "masked"] as const) channels[channel].text = buffers[channel].join("");
  return channels;
};

const compileRule = (rule: LyricsRule): CompiledLyricsRule => {
  const channel: Channel = rule.masked ? "masked" : rule.language === "en" ? "en" : "ko";
  const termsByNeedle = new Map<string, string>();
  for (const value of rule.variants) {
    const text = mapText(value)[channel].text;
    const needle = channel === "ko" ? text : text.replace(/([a-z])\1+/g, "$1");
    if (needle && !termsByNeedle.has(needle)) termsByNeedle.set(needle, value);
  }
  return { ...rule, channel, needles: [...termsByNeedle.keys()], termsByNeedle };
};
const defaultRules = (dictionary.rules as LyricsRule[]).map(compileRule);
const safePhrases = dictionary.safeKoreanPhrases.map(phrase => ({ original: phrase, text: mapText(phrase).ko.text }));

const boundaryCharacter = (source: string, offset: number, direction: -1 | 1) => {
  let cursor = offset;
  while (direction === -1 ? cursor > 0 : cursor < source.length) {
    const value = direction === -1 ? source.slice(Math.max(0, cursor - 2), cursor) : source.slice(cursor, cursor + 2);
    const points = Array.from(value);
    const character = direction === -1 ? points[points.length - 1] : points[0];
    if (!ignorable.test(character) || /\p{White_Space}/u.test(character)) return compatible(character.normalize("NFKD").toLowerCase()[0]);
    cursor += direction * character.length;
  }
  return "";
};

const hasLeftBoundary = (source: string, mapped: MappedText, index: number, korean: boolean) => {
  const start = mapped.starts[index];
  // A match cannot begin/end in the middle of a Unicode expansion.
  if (index > 0 && mapped.ends[index - 1] > start) return false;
  const isWord = korean ? word : englishWord;
  return !isWord.test(boundaryCharacter(source, start, -1));
};
const hasRightBoundary = (source: string, mapped: MappedText, index: number, korean: boolean) => {
  const end = mapped.ends[index];
  if (index + 1 < mapped.text.length && mapped.starts[index + 1] < end) return false;
  const isWord = korean ? word : englishWord;
  return !isWord.test(boundaryCharacter(source, end, 1));
};

// Deterministically fold repeated English letters even across separators.
// Keep each run's edges: "of fuck" must start at the second f, while
// "fuck kitchen" must end at the first k. A regex such as f+u+c+k+ on a long
// separated run could backtrack quadratically; literal run searches cannot.
const foldRuns = (mapped: MappedText, english: boolean): SearchText => {
  const search: SearchText = { text: "", first: [], last: [] };
  const characters: string[] = [];
  for (let index = 0; index < mapped.text.length; index++) {
    const character = mapped.text[index];
    const previous = characters.length - 1;
    if (english && asciiLetter.test(character) && characters[previous] === character) {
      search.last[previous] = index;
    } else {
      characters.push(character);
      search.first.push(index);
      search.last.push(index);
    }
  }
  search.text = characters.join("");
  return search;
};

const hasKoreanStart = (source: string, mapped: MappedText, index: number) => {
  if (hasLeftBoundary(source, mapped, index, true)) return true;
  const start = mapped.starts[index];
  // Explicit insult prefixes are recognized without joining the end of an
  // ordinary word: 다시 발걸음 / 질병 신호 / 생존 나비 must stay clean.
  for (const prefix of ["개", "이", "아", "씹", "존나", "이런", "저런", "미친", "아니", "진짜"]) {
    const prefixStart = start - prefix.length;
    if (prefixStart >= 0 && source.slice(prefixStart, start) === prefix && !word.test(boundaryCharacter(source, prefixStart, -1))) return true;
  }
  return false;
};

export function analyzeLyricsProfanity(text: string, extraTerms: ProfanityTerm[] = []): LyricsProfanityAnalysis {
  let analyzedLength = Math.min(text.length, LYRICS_PROFANITY_LIMITS.textLength);
  if (analyzedLength < text.length && /[\uDC00-\uDFFF]/.test(text[analyzedLength])) analyzedLength--;
  const source = text.slice(0, analyzedLength);
  const mapped = mapText(source);
  const searches = { ko: foldRuns(mapped.ko, false), en: foldRuns(mapped.en, true), masked: foldRuns(mapped.masked, true) };
  let truncated = analyzedLength < text.length || extraTerms.length > LYRICS_PROFANITY_LIMITS.extraTerms;
  const rules = [...defaultRules];
  const seenTerms = new Set<string>();
  for (const item of extraTerms.slice(0, LYRICS_PROFANITY_LIMITS.extraTerms)) {
    const term = item.term?.trim();
    if (!term) continue;
    if (term.length > LYRICS_PROFANITY_LIMITS.termLength) { truncated = true; continue; }
    const language = item.language?.toUpperCase() === "EN" ? "en" : "ko";
    const compiled = compileRule({ id: `lyrics_custom_${rules.length}`, term, variants: [term], language, category: "confident", reason: "custom" });
    const key = `${language}:${compiled.needles[0] ?? ""}`;
    if (!compiled.needles.length || seenTerms.has(key)) continue;
    seenTerms.add(key);
    rules.push(compiled);
  }
  const safeRanges: Array<{ start: number; end: number }> = [];
  for (const phrase of safePhrases) {
    let index = mapped.ko.text.indexOf(phrase.text);
    while (index !== -1) {
      const start = mapped.ko.starts[index], end = mapped.ko.ends[index + phrase.text.length - 1];
      // A compound such as 시발역 must not exempt "시발 역겨워".
      const raw = source.slice(start, end);
      const stationOrOrigin = /^(?:시발역|시발지)$/u.test(raw.normalize("NFKC"));
      const safeSuffix = !stationOrOrigin || /^(?:$|[^\p{L}\p{N}]|에서|으로|부터|까지|에게|에는|은|는|이|가|을|를|에|와|과|도|만)/u.test(source.slice(end));
      const safeSpacing = !phrase.original.startsWith("시발") || !/\p{White_Space}/u.test(raw);
      if (safeSuffix && safeSpacing && !/[\p{P}\p{S}\p{N}]/u.test(raw)) safeRanges.push({ start, end });
      index = mapped.ko.text.indexOf(phrase.text, index + phrase.text.length);
    }
  }
  safeRanges.sort((a, b) => a.start - b.start || b.end - a.end);
  // Merge once so repeated safe phrases cannot cause quadratic span checks.
  const safe: typeof safeRanges = [];
  for (const range of safeRanges) {
    const previous = safe[safe.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else safe.push({ ...range });
  }
  const isSafe = (start: number, end: number) => {
    let low = 0, high = safe.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (safe[mid].start <= start) low = mid + 1;
      else high = mid - 1;
    }
    return high >= 0 && safe[high].end >= end;
  };
  const candidates: LyricsProfanityMatch[] = [];
  const seen = new Set<string>();
  let hasProfanity = false, hasSuspectedProfanity = false;
  for (const rule of rules) {
    const channel = mapped[rule.channel];
    const search = searches[rule.channel];
    for (const needle of rule.needles) {
      let index = search.text.indexOf(needle);
      while (index !== -1) {
        let first = search.first[index], last = search.last[index + needle.length - 1];
        const needsBoundary = rule.language === "en" || rule.boundary === "word";
        const korean = rule.language !== "en";
        if (needsBoundary) {
          while (first <= search.last[index] && !hasLeftBoundary(source, channel, first, korean)) first++;
          while (last >= search.first[index + needle.length - 1] && !hasRightBoundary(source, channel, last, korean)) last--;
        }
        const boundary = needsBoundary
          ? first <= search.last[index] && last >= search.first[index + needle.length - 1] && first <= last
          : rule.reason === "custom" || hasKoreanStart(source, channel, first);
        const start = channel.starts[first], end = channel.ends[last];
        if (boundary && (rule.reason === "custom" || !isSafe(start, end))) {
          if (rule.category === "confident") hasProfanity = true;
          else hasSuspectedProfanity = true;
          const key = `${start}:${end}:${rule.category}`;
          if (!seen.has(key)) {
            if (candidates.length >= LYRICS_PROFANITY_LIMITS.matches) { truncated = true; break; }
            seen.add(key);
            candidates.push({ start, end, matchedText: text.slice(start, end), term: rule.termsByNeedle.get(needle) ?? rule.term, ruleId: rule.id,
              reason: reasonText[rule.reason ?? "dictionary"], category: rule.category, language: rule.language });
          }
        }
        index = search.text.indexOf(needle, index + Math.max(1, needle.length));
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start || (a.category === b.category ? 0 : a.category === "confident" ? -1 : 1) || b.end - a.end);
  const matches: LyricsProfanityMatch[] = [];
  for (const match of candidates) {
    const previous = matches[matches.length - 1];
    if (previous && match.start < previous.end) {
      if (previous.category === "suspected" && match.category === "confident") matches[matches.length - 1] = match;
      continue;
    }
    matches.push(match);
  }
  return { hasProfanity: matches.some(match => match.category === "confident") || (truncated && hasProfanity),
    hasSuspectedProfanity: matches.some(match => match.category === "suspected") || (truncated && hasSuspectedProfanity),
    matches, truncated, analyzedLength, sourceLength: text.length };
}
