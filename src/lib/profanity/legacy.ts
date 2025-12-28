export type ProfanityTerm = {
  term: string;
  language?: string | null;
};

const baseProfanityKoreanTerms = [
  "씨발",
  "시발",
  "ㅅㅂ",
  "좆",
  "존나",
  "새끼",
  "개새끼",
  "병신",
  "지랄",
  "썅",
];

const baseProfanityEnglishTerms = [
  "fuck",
  "fucking",
  "shit",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "motherfucker",
  "dick",
  "pussy",
  "cunt",
  "slut",
  "whore",
];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTermKey = (value: string) => value.trim().toLowerCase();

export const buildLegacyProfanityMatchers = (terms?: ProfanityTerm[]) => {
  const customKorean: string[] = [];
  const customEnglish: string[] = [];

  (terms ?? []).forEach((item) => {
    const term = item.term?.trim();
    if (!term) return;
    const language = (item.language ?? "KO").toUpperCase();
    if (language === "EN") {
      customEnglish.push(term);
    } else {
      customKorean.push(term);
    }
  });

  const uniqueTerms = (values: string[]) => {
    const seen = new Set<string>();
    const output: string[] = [];
    values.forEach((value) => {
      const key = normalizeTermKey(value);
      if (!key || seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
    return output;
  };

  const koreanTerms = uniqueTerms([
    ...baseProfanityKoreanTerms,
    ...customKorean,
  ]);
  const englishTerms = uniqueTerms([
    ...baseProfanityEnglishTerms,
    ...customEnglish,
  ]);

  const koreanPattern = koreanTerms.map(escapeRegExp).join("|");
  const englishPattern = englishTerms.map(escapeRegExp).join("|");
  const sources = [
    koreanPattern,
    englishPattern ? `\\b(?:${englishPattern})\\b` : "",
  ]
    .filter(Boolean)
    .join("|");

  if (!sources) return null;

  return {
    pattern: new RegExp(`(${sources})`, "gi"),
    testPattern: new RegExp(`(${sources})`, "i"),
  };
};

export const extractProfanityWords = (
  value: string,
  pattern?: RegExp | null,
) => {
  if (!value || !pattern) return [];
  const matches = value.match(pattern);
  if (!matches) return [];
  const unique = new Set(matches.map((item) => item.trim()).filter(Boolean));
  return Array.from(unique);
};
