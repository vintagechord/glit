import { KO_SPELLCHECK_RULES as LEGACY_RULES } from "../rules_ko";
import { KO_SPELLCHECK_RULES as CORE_RULES } from "@/lib/spellcheck-rules";

import type { RuleEntry } from "./types";
import { FOREIGN_NUMBER_RULES } from "./foreign";
import { STYLE_RULES } from "./style";

const normalizeRule = (rule: RuleEntry): RuleEntry => ({
  ...rule,
  pattern: rule.pattern.flags.includes("g")
    ? rule.pattern
    : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`),
});

const dedupeRules = (rules: RuleEntry[]) => {
  const seen = new Map<string, RuleEntry>();
  rules.forEach((rule) => {
    const key = `${rule.pattern.source}/${rule.pattern.flags}|${rule.replace}|${rule.reason}`;
    if (!seen.has(key)) {
      seen.set(key, normalizeRule(rule));
    }
  });
  return Array.from(seen.values());
};

const legacyRules: RuleEntry[] = (LEGACY_RULES ?? []).map((rule) => ({
  pattern: rule.pattern,
  replace: rule.replace,
  reason: rule.reason,
  confidence: rule.confidence,
}));

const coreRules: RuleEntry[] = (CORE_RULES ?? []).map((rule) => ({
  pattern: rule.pattern,
  replace: rule.replace,
  reason: rule.reason,
  confidence: rule.confidence,
}));

export const KO_RULES = dedupeRules([...coreRules, ...legacyRules]);
export const FOREIGN_RULES = dedupeRules(FOREIGN_NUMBER_RULES);
export const STYLE_RULES_LIST = dedupeRules(STYLE_RULES);

export const ALL_RULES = dedupeRules([...KO_RULES, ...FOREIGN_RULES, ...STYLE_RULES_LIST]);
