export type SpellcheckTerm = {
  from_text: string;
  to_text: string;
  language: string | null;
};

export type SpellcheckRule = {
  pattern: RegExp;
  replace: string;
};

export type SpellcheckChange = {
  from: string;
  to: string;
  index: number;
};

export type SpellcheckSuccess = {
  ok: true;
  original: string;
  corrected: string;
  changes: SpellcheckChange[];
  truncated: boolean;
};

export type SpellcheckError = {
  ok: false;
  error: { code: string; message: string };
};

export type SpellcheckResult = SpellcheckSuccess | SpellcheckError;

export const MAX_TEXT_LENGTH = 20000;
export const MIN_LENGTH_RATIO = 0.5;
export const MIN_LENGTH_CHECK_THRESHOLD = 20;

export const basicCorrections: SpellcheckRule[] = [
  { pattern: /됬/g, replace: "됐" },
  { pattern: /됫/g, replace: "됐" },
  { pattern: /싫엇/g, replace: "싫었" },
  { pattern: /이엇/g, replace: "이었" },
  { pattern: /잇/g, replace: "있" },
  { pattern: /거\s?같/g, replace: "것 같" },
  { pattern: /놀리는거/g, replace: "놀리는 거" },
  { pattern: /못햇다/g, replace: "못했다" },
  { pattern: /못햇/g, replace: "못했" },
  { pattern: /안되/g, replace: "안 돼" },
  { pattern: /안돼다/g, replace: "안 되다" },
  { pattern: /됄/g, replace: "될" },
  { pattern: /됬다/g, replace: "됐다" },
  { pattern: /됬어요/g, replace: "됐어요" },
  { pattern: /되요/g, replace: "돼요" },
  { pattern: /되서/g, replace: "돼서" },
  { pattern: /할께/g, replace: "할게" },
  { pattern: /할께요/g, replace: "할게요" },
  { pattern: /될께/g, replace: "될게" },
  { pattern: /되겠지요/g, replace: "되겠죠" },
  { pattern: /그럴께/g, replace: "그럴게" },
  { pattern: /안됌/g, replace: "안 됨" },
  { pattern: /됌/g, replace: "됨" },
  { pattern: /안되요/g, replace: "안 돼요" },
  { pattern: /안되죠/g, replace: "안 되죠" },
  { pattern: /안되면/g, replace: "안 되면" },
  { pattern: /되면안/g, replace: "되면 안" },
  { pattern: /어떻해/g, replace: "어떻게" },
  { pattern: /어떻케/g, replace: "어떻게" },
  { pattern: /됬을/g, replace: "됐을" },
  { pattern: /됬겠/g, replace: "됐겠" },
  { pattern: /됬던/g, replace: "됐던" },
];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const buildCustomRules = (terms: SpellcheckTerm[]) =>
  terms
    .map((term) => {
      const fromText = term.from_text?.trim();
      const toText = term.to_text?.trim();
      if (!fromText || !toText) return null;
      const language = (term.language ?? "KO").toUpperCase();
      const pattern =
        language === "EN"
          ? new RegExp(`\\b${escapeRegExp(fromText)}\\b`, "gi")
          : new RegExp(escapeRegExp(fromText), "g");
      return { pattern, replace: toText };
    })
    .filter(Boolean) as SpellcheckRule[];

export const applyReplacementRules = (text: string, rules: SpellcheckRule[]) => {
  let corrected = text;
  const changes: SpellcheckChange[] = [];

  rules.forEach((rule) => {
    const matches = Array.from(corrected.matchAll(rule.pattern));
    if (!matches.length) return;
    corrected = corrected.replace(rule.pattern, rule.replace);
    matches.forEach((match) => {
      const before = match[0];
      if (!before) return;
      const index = typeof match.index === "number" ? match.index : 0;
      changes.push({ from: before, to: rule.replace, index });
    });
  });

  return { corrected, changes };
};

const buildError = (code: string, message: string): SpellcheckError => ({
  ok: false,
  error: { code, message },
});

export const spellcheckText = (text: string, rules: SpellcheckRule[]) => {
  if (!text.trim()) {
    return buildError("EMPTY_TEXT", "내용을 입력해주세요.");
  }

  let workingText = text;
  let remainder = "";
  let truncated = false;
  if (text.length > MAX_TEXT_LENGTH) {
    workingText = text.slice(0, MAX_TEXT_LENGTH);
    remainder = text.slice(MAX_TEXT_LENGTH);
    truncated = true;
  }

  const { corrected: correctedPartial, changes } = applyReplacementRules(
    workingText,
    rules,
  );
  const corrected = correctedPartial + remainder;

  if (!corrected.trim()) {
    return buildError("CORRECTION_INVALID", "맞춤법 결과가 비정상입니다.");
  }

  if (
    text.length > MIN_LENGTH_CHECK_THRESHOLD &&
    corrected.length < text.length * MIN_LENGTH_RATIO
  ) {
    return buildError("CORRECTION_INVALID", "맞춤법 결과가 비정상입니다.");
  }

  return {
    ok: true,
    original: text,
    corrected,
    changes,
    truncated,
  } satisfies SpellcheckSuccess;
};

// Masks english tokens to placeholders and builds index mapping to original text.
const maskNonKoreanTokens = (text: string) => {
  const regex = /[A-Za-z][A-Za-z0-9'_.-]*/g;
  const replacements: Array<{
    start: number;
    end: number;
    placeholder: string;
    original: string;
  }> = [];
  let match: RegExpExecArray | null;
  let counter = 0;
  while ((match = regex.exec(text))) {
    if (!match[0]) continue;
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      placeholder: `__EN${counter}__`,
      original: match[0],
    });
    counter += 1;
  }

  if (!replacements.length) {
    return { sanitized: text, indexMap: Array.from({ length: text.length }, (_, i) => i) };
  }

  let cursor = 0;
  let sanitized = "";
  const indexMap: number[] = [];

  replacements.forEach((rep) => {
    if (cursor < rep.start) {
      const segment = text.slice(cursor, rep.start);
      sanitized += segment;
      for (let i = 0; i < segment.length; i += 1) {
        indexMap.push(cursor + i);
      }
    }
    sanitized += rep.placeholder;
    for (let i = 0; i < rep.placeholder.length; i += 1) {
      indexMap.push(rep.start);
    }
    cursor = rep.end;
  });

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    sanitized += tail;
    for (let i = 0; i < tail.length; i += 1) {
      indexMap.push(cursor + i);
    }
  }

  return { sanitized, indexMap };
};

export type LocalRuleSuggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason?: string;
};

export const runLocalRuleEngine = (text: string, rules: SpellcheckRule[]) => {
  const { sanitized, indexMap } = maskNonKoreanTokens(text.replace(/[“”]/g, '"').replace(/[’‘]/g, "'"));
  const suggestions: LocalRuleSuggestion[] = [];
  rules.forEach((rule) => {
    const pattern = rule.pattern.global ? rule.pattern : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    const matches = Array.from(sanitized.matchAll(pattern));
    matches.forEach((match) => {
      if (!match[0]) return;
      const startSanitized = match.index ?? 0;
      const endSanitized = startSanitized + match[0].length;
      const start = indexMap[startSanitized] ?? startSanitized;
      const end = (indexMap[endSanitized - 1] ?? endSanitized - 1) + 1;
      const before = text.slice(start, end);
      const after = match[0].replace(rule.pattern, rule.replace);
      suggestions.push({
        start,
        end,
        before,
        after,
        reason: "local_rule",
      });
    });
  });
  return { suggestions, ruleHitCount: suggestions.length };
};
