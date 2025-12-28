import rulesData from "../../../config/profanity_rules.json";
import allowlistData from "../../../config/profanity_allowlist.json";

export type ProfanitySeverity = "BLOCK" | "MASK" | "WARN";
export type ProfanityAction = "allow" | "warn" | "mask" | "block";

export type RuleConfig = {
  id: string;
  severity: ProfanitySeverity;
  pattern: string;
  description: string;
  lang: "ko" | "en" | "mixed";
  score: number;
};

export type AllowlistEntry = {
  id: string;
  pattern: string;
  description: string;
  lang: "ko" | "en" | "mixed";
};

export type ProfanityEvaluation = {
  action: ProfanityAction;
  score: number;
  matched_rule_ids: string[];
  masked_text?: string;
};

export type ProfanityEvaluateOptions = {
  rules?: RuleConfig[];
  allowlist?: AllowlistEntry[];
  extraRules?: RuleConfig[];
  thresholds?: {
    warn: number;
    mask: number;
    block: number;
  };
};

type CompiledRule = RuleConfig & { regex: RegExp };

type CompiledAllowlist = AllowlistEntry & { regex: RegExp };

type Span = { start: number; end: number };

const DEFAULT_THRESHOLDS = {
  warn: 1,
  mask: 4,
  block: 7,
};

const CONTROL_CHARS_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const INLINE_EXCLAMATION_REGEX = /([\p{L}\p{N}])!([\p{L}\p{N}])/gu;
const LEET_REGEX = /[@01$37]/g;
const LEET_MAP: Record<string, string> = {
  "@": "a",
  "0": "o",
  "1": "i",
  "$": "s",
  "3": "e",
  "7": "t",
};
const SEPARATOR_REGEX = /[\-_.*/\\|+~`^'":;!?()[\]{}<>#,]/g;
const REPEAT_REGEX = /(.)\1{2,}/g;
const JAMO_SPACE_REGEX =
  /([ㄱ-ㅎㅏ-ㅣ\u1100-\u11FF])\s+(?=[ㄱ-ㅎㅏ-ㅣ\u1100-\u11FF])/g;

const HANGUL_BASE = 0xac00;
const HANGUL_L_BASE = 0x1100;
const HANGUL_V_BASE = 0x1161;
const HANGUL_T_BASE = 0x11a7;
const HANGUL_L_COUNT = 19;
const HANGUL_V_COUNT = 21;
const HANGUL_T_COUNT = 28;
const HANGUL_S_COUNT = HANGUL_L_COUNT * HANGUL_V_COUNT * HANGUL_T_COUNT;

const HANGUL_L_LIST = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

const HANGUL_V_LIST = [
  "ㅏ",
  "ㅐ",
  "ㅑ",
  "ㅒ",
  "ㅓ",
  "ㅔ",
  "ㅕ",
  "ㅖ",
  "ㅗ",
  "ㅘ",
  "ㅙ",
  "ㅚ",
  "ㅛ",
  "ㅜ",
  "ㅝ",
  "ㅞ",
  "ㅟ",
  "ㅠ",
  "ㅡ",
  "ㅢ",
  "ㅣ",
];

const HANGUL_T_LIST = [
  "",
  "ㄱ",
  "ㄲ",
  "ㄳ",
  "ㄴ",
  "ㄵ",
  "ㄶ",
  "ㄷ",
  "ㄹ",
  "ㄺ",
  "ㄻ",
  "ㄼ",
  "ㄽ",
  "ㄾ",
  "ㄿ",
  "ㅀ",
  "ㅁ",
  "ㅂ",
  "ㅄ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

const HANGUL_L_MAP = new Map(HANGUL_L_LIST.map((ch, index) => [ch, index]));
const HANGUL_V_MAP = new Map(HANGUL_V_LIST.map((ch, index) => [ch, index]));
const HANGUL_T_MAP = new Map(
  HANGUL_T_LIST.map((ch, index) => [ch, index]).filter(([ch]) => ch),
);
const HANGUL_L_TO_T_MAP = new Map(
  HANGUL_L_LIST.map((compat, index) => {
    const trailingIndex = HANGUL_T_MAP.get(compat);
    const leadingChar = String.fromCharCode(HANGUL_L_BASE + index);
    return trailingIndex ? [leadingChar, trailingIndex] : null;
  }).filter((entry): entry is [string, number] => Boolean(entry)),
);

let cachedRules: CompiledRule[] | null = null;
let cachedAllowlist: CompiledAllowlist[] | null = null;

const compileRegex = (pattern: string) => {
  try {
    return new RegExp(pattern, "gu");
  } catch (error) {
    console.error("Invalid profanity regex:", pattern, error);
    return null;
  }
};

const compileRules = (rules: RuleConfig[]): CompiledRule[] =>
  rules
    .map((rule) => {
      const regex = compileRegex(rule.pattern);
      if (!regex) return null;
      return { ...rule, regex };
    })
    .filter((rule): rule is CompiledRule => Boolean(rule));

const compileAllowlist = (entries: AllowlistEntry[]): CompiledAllowlist[] =>
  entries
    .map((entry) => {
      const regex = compileRegex(entry.pattern);
      if (!regex) return null;
      return { ...entry, regex };
    })
    .filter((entry): entry is CompiledAllowlist => Boolean(entry));

const getCompiledRules = (rules?: RuleConfig[], extra?: RuleConfig[]) => {
  if (rules) return compileRules(rules);
  if (!cachedRules) {
    cachedRules = compileRules(rulesData as RuleConfig[]);
  }
  if (!extra?.length) return cachedRules;
  return cachedRules.concat(compileRules(extra));
};

const getCompiledAllowlist = (allowlist?: AllowlistEntry[]) => {
  if (allowlist) return compileAllowlist(allowlist);
  if (!cachedAllowlist) {
    cachedAllowlist = compileAllowlist(allowlistData as AllowlistEntry[]);
  }
  return cachedAllowlist;
};

const getLIndex = (ch: string) => {
  const code = ch.codePointAt(0);
  if (!code) return null;
  if (code >= HANGUL_L_BASE && code <= HANGUL_L_BASE + HANGUL_L_COUNT - 1) {
    return code - HANGUL_L_BASE;
  }
  return HANGUL_L_MAP.get(ch) ?? null;
};

const getVIndex = (ch: string) => {
  const code = ch.codePointAt(0);
  if (!code) return null;
  if (code >= HANGUL_V_BASE && code <= HANGUL_V_BASE + HANGUL_V_COUNT - 1) {
    return code - HANGUL_V_BASE;
  }
  return HANGUL_V_MAP.get(ch) ?? null;
};

const getTIndex = (ch: string) => {
  const code = ch.codePointAt(0);
  if (!code) return null;
  if (code >= HANGUL_T_BASE + 1 && code <= HANGUL_T_BASE + HANGUL_T_COUNT - 1) {
    return code - HANGUL_T_BASE;
  }
  if (code >= HANGUL_L_BASE && code <= HANGUL_L_BASE + HANGUL_L_COUNT - 1) {
    return HANGUL_L_TO_T_MAP.get(ch) ?? null;
  }
  return HANGUL_T_MAP.get(ch) ?? null;
};

const mapJamoToCompatibility = (value: string) => {
  let output = "";
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (!code) continue;
    if (code >= HANGUL_L_BASE && code <= HANGUL_L_BASE + HANGUL_L_COUNT - 1) {
      output += HANGUL_L_LIST[code - HANGUL_L_BASE] ?? ch;
      continue;
    }
    if (code >= HANGUL_V_BASE && code <= HANGUL_V_BASE + HANGUL_V_COUNT - 1) {
      output += HANGUL_V_LIST[code - HANGUL_V_BASE] ?? ch;
      continue;
    }
    if (code >= HANGUL_T_BASE + 1 && code <= HANGUL_T_BASE + HANGUL_T_COUNT - 1) {
      output += HANGUL_T_LIST[code - HANGUL_T_BASE] ?? ch;
      continue;
    }
    output += ch;
  }
  return output;
};

const composeHangulJamo = (value: string) => {
  const chars = Array.from(value);
  let index = 0;
  let output = "";

  while (index < chars.length) {
    const ch = chars[index];
    const code = ch.codePointAt(0);
    if (code && code >= HANGUL_BASE && code < HANGUL_BASE + HANGUL_S_COUNT) {
      if (index + 1 < chars.length) {
        const tCandidate = getTIndex(chars[index + 1]);
        const nextVowel =
          index + 2 < chars.length ? getVIndex(chars[index + 2]) : null;
        if (tCandidate && nextVowel === null) {
          const syllableIndex = code - HANGUL_BASE;
          const tIndex = syllableIndex % HANGUL_T_COUNT;
          if (tIndex === 0) {
            const lIndex = Math.floor(
              syllableIndex / (HANGUL_V_COUNT * HANGUL_T_COUNT),
            );
            const vIndex = Math.floor(
              (syllableIndex % (HANGUL_V_COUNT * HANGUL_T_COUNT)) /
                HANGUL_T_COUNT,
            );
            const syllableCode =
              HANGUL_BASE +
              (lIndex * HANGUL_V_COUNT + vIndex) * HANGUL_T_COUNT +
              tCandidate;
            output += String.fromCharCode(syllableCode);
            index += 2;
            continue;
          }
        }
      }
      output += ch;
      index += 1;
      continue;
    }
    const lIndex = getLIndex(ch);

    if (lIndex !== null && index + 1 < chars.length) {
      const vIndex = getVIndex(chars[index + 1]);
      if (vIndex !== null) {
        let tIndex = 0;
        let nextIndex = index + 2;
        if (nextIndex < chars.length) {
          const tCandidate = getTIndex(chars[nextIndex]);
          const nextVowel =
            nextIndex + 1 < chars.length
              ? getVIndex(chars[nextIndex + 1])
              : null;
          if (tCandidate !== null && nextVowel === null) {
            tIndex = tCandidate;
            nextIndex += 1;
          }
        }
        const syllableCode =
          HANGUL_BASE + (lIndex * HANGUL_V_COUNT + vIndex) * HANGUL_T_COUNT + tIndex;
        output += String.fromCharCode(syllableCode);
        index = nextIndex;
        continue;
      }
    }

    output += ch;
    index += 1;
  }

  return output;
};

export const normalize = (value: string) => {
  if (!value) return "";
  let text = value;
  if (typeof text.normalize === "function") {
    text = text.normalize("NFKC");
  }
  text = mapJamoToCompatibility(text);
  text = text.toLowerCase();
  text = text.replace(CONTROL_CHARS_REGEX, "");
  text = text.replace(INLINE_EXCLAMATION_REGEX, "$1i$2");
  text = text.replace(LEET_REGEX, (match) => LEET_MAP[match] ?? match);
  text = text.replace(SEPARATOR_REGEX, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(REPEAT_REGEX, "$1$1");
  text = text.replace(JAMO_SPACE_REGEX, "$1");
  text = composeHangulJamo(text);
  text = text.replace(/\s+/g, " ").trim();
  return text;
};

const collectSpans = (text: string, entries: CompiledAllowlist[]) => {
  const spans: Span[] = [];
  entries.forEach((entry) => {
    entry.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.regex.exec(text)) !== null) {
      if (!match[0]) {
        entry.regex.lastIndex += 1;
        continue;
      }
      const start = match.index;
      spans.push({ start, end: start + match[0].length });
    }
  });
  return spans;
};

const isAllowlistedSpan = (start: number, end: number, spans: Span[]) =>
  spans.some((span) => start >= span.start && end <= span.end);

export const evaluate = (
  value: string,
  options: ProfanityEvaluateOptions = {},
): ProfanityEvaluation => {
  const normalized = normalize(value);
  if (!normalized) {
    return { action: "allow", score: 0, matched_rule_ids: [] };
  }

  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const rules = getCompiledRules(options.rules, options.extraRules);
  const allowlist = getCompiledAllowlist(options.allowlist);

  const allowlistSpans = allowlist.length
    ? collectSpans(normalized, allowlist)
    : [];

  const matchedRuleIds: string[] = [];
  const matchedRuleSet = new Set<string>();
  const matchCounts: Record<string, number> = {};
  let score = 0;
  let hasWarn = false;
  let hasMask = false;
  let hasBlock = false;

  rules.forEach((rule) => {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(normalized)) !== null) {
      if (!match[0]) {
        rule.regex.lastIndex += 1;
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (allowlistSpans.length && isAllowlistedSpan(start, end, allowlistSpans)) {
        continue;
      }
      if (!matchedRuleSet.has(rule.id)) {
        matchedRuleSet.add(rule.id);
        matchedRuleIds.push(rule.id);
      }
      matchCounts[rule.id] = (matchCounts[rule.id] ?? 0) + 1;

      if (rule.severity === "BLOCK") {
        hasBlock = true;
      } else if (rule.severity === "MASK") {
        hasMask = true;
      } else {
        hasWarn = true;
      }

      score += rule.score;
    }
  });

  Object.values(matchCounts).forEach((count) => {
    if (count > 1) {
      score += count - 1;
    }
  });

  if (matchedRuleIds.length > 0) {
    if (/[A-Z]{4,}/.test(value)) {
      score += 1;
    }
    if (/[!?]{3,}/.test(value)) {
      score += 1;
    }
    if (/@[\w-]{2,}/.test(value)) {
      score += 1;
    }
  }

  let action: ProfanityAction = "allow";
  if (hasBlock) {
    action = "block";
  } else if (hasMask) {
    action = "mask";
  } else if (hasWarn || matchedRuleIds.length > 0) {
    action = "warn";
  }

  if (action !== "block" && score >= thresholds.block) {
    action = "block";
  } else if (action === "warn" && score >= thresholds.mask) {
    action = "mask";
  }

  if (action === "allow") {
    return { action, score: 0, matched_rule_ids: [] };
  }

  return {
    action,
    score,
    matched_rule_ids: matchedRuleIds,
  };
};

export const buildAuditPayload = (
  result: ProfanityEvaluation,
  options?: { hash?: string },
) => ({
  matched_rule_ids: result.matched_rule_ids,
  action: result.action,
  score: result.score,
  hash: options?.hash,
});
