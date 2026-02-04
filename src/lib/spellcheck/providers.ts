import type {
  SpellcheckDomain,
  SpellcheckMode,
  SuggestionType,
} from "./types";
import { runHybridSpellcheck } from "@/lib/spellcheck-hybrid";
import { ALL_RULES, FOREIGN_RULES, STYLE_RULES_LIST } from "./rules";
import type { RuleEntry } from "./rules/types";
import { normalizeText } from "./normalize";
import { diffText } from "./diff";

export type ProviderSuggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason: string;
  confidence: number;
  type?: SuggestionType;
  source: string;
};

export type ProviderResult = {
  suggestions: ProviderSuggestion[];
  confidence: number;
  warnings?: string[];
  raw?: unknown;
};

export type ProviderContext = {
  mode: SpellcheckMode;
  domain: SpellcheckDomain;
  signal?: AbortSignal;
};

export type SpellcheckProvider = {
  name: string;
  supports: (lang: string) => boolean;
  check: (text: string, context: ProviderContext) => Promise<ProviderResult>;
};

const clampConfidence = (value: number | undefined, fallback: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

const classifyByReason = (reason: string): SuggestionType => {
  const lowered = reason.toLowerCase();
  if (lowered.includes("띄어쓰기") || lowered.includes("spacing")) return "spacing";
  if (
    lowered.includes("문장부호") ||
    lowered.includes("따옴표") ||
    lowered.includes("괄호") ||
    lowered.includes("쉼표") ||
    lowered.includes("마침표")
  ) {
    return "punctuation";
  }
  if (
    lowered.includes("외래") ||
    lowered.includes("영문") ||
    lowered.includes("숫자") ||
    lowered.includes("단위")
  ) {
    return "foreign";
  }
  if (lowered.includes("스타일") || lowered.includes("이모지") || lowered.includes("반복")) {
    return "style";
  }
  return "orthography";
};

const applyReplacementOnce = (before: string, rule: RuleEntry): string | null => {
  const flags = rule.pattern.flags.replace("g", "");
  const once = new RegExp(rule.pattern.source, flags);
  const match = once.exec(before);
  if (!match) return null;
  return before.replace(once, rule.replace);
};

const collectRuleSuggestions = (text: string, rules: RuleEntry[], source: string) => {
  const suggestions: ProviderSuggestion[] = [];
  rules.forEach((rule) => {
    const pattern = rule.pattern.flags.includes("g")
      ? rule.pattern
      : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const before = match[0];
      if (!before) continue;
      const after = applyReplacementOnce(before, rule);
      if (!after || after === before) continue;
      const start = match.index ?? 0;
      const end = start + before.length;
      suggestions.push({
        start,
        end,
        before,
        after,
        reason: rule.reason,
        confidence: clampConfidence(rule.confidence, 0.8),
        type: rule.type ?? classifyByReason(rule.reason),
        source,
      });
      if (pattern.lastIndex === start) {
        pattern.lastIndex = start + 1;
      }
    }
  });
  return suggestions;
};

export const createRuleProvider = (name: string, rules: RuleEntry[]): SpellcheckProvider => ({
  name,
  supports: (lang) => lang === "ko",
  check: async (text) => ({
    suggestions: collectRuleSuggestions(text, rules, name),
    confidence: 0.8,
  }),
});

export const createHybridProvider = (): SpellcheckProvider => ({
  name: "hybrid_rules",
  supports: (lang) => lang === "ko",
  check: async (text) => {
    const { changes } = runHybridSpellcheck(text, { maxIterations: 4 });
    const suggestions: ProviderSuggestion[] = changes.map((change) => {
      const baseReason = change.rule.split("#")[0];
      const type: SuggestionType =
        baseReason.startsWith("space_") ? "spacing" :
        baseReason.startsWith("punc_") ? "punctuation" :
        baseReason.startsWith("aux_") ? "orthography" :
        baseReason.startsWith("particle_") ? "spacing" :
        "orthography";
      return {
        start: change.start,
        end: change.end,
        before: change.before,
        after: change.after,
        reason: baseReason,
        confidence: clampConfidence(change.confidence, 0.7),
        type,
        source: "hybrid_rules",
      };
    });
    return { suggestions, confidence: 0.75 };
  },
});

export const createForeignProvider = (): SpellcheckProvider =>
  createRuleProvider("foreign_rules", FOREIGN_RULES);

export const createStyleProvider = (): SpellcheckProvider =>
  createRuleProvider("style_rules", STYLE_RULES_LIST);

export const createCoreRuleProvider = (): SpellcheckProvider =>
  createRuleProvider("local_rules", ALL_RULES);

export const createNormalizationProvider = (): SpellcheckProvider => ({
  name: "normalize",
  supports: () => true,
  check: async (text) => {
    const { normalized } = normalizeText(text);
    if (normalized === text) {
      return { suggestions: [], confidence: 0.4 };
    }
    const diffs = diffText(text, normalized);
    const suggestions: ProviderSuggestion[] = diffs
      .filter((diff) => diff.op !== "equal")
      .map((diff) => {
        const before = diff.a;
        const after = diff.b;
        const reason =
          diff.op === "delete"
            ? "공백/특수문자 정리"
            : diff.op === "insert"
              ? "문장부호/공백 보정"
              : "정규화";
        const type: SuggestionType =
          /\s/.test(before + after)
            ? "spacing"
            : /[“”’‘"'.!?…-]/.test(before + after)
              ? "punctuation"
              : "style";
        return {
          start: diff.indexA,
          end: diff.indexA + before.length,
          before,
          after,
          reason,
          confidence: 0.8,
          type,
          source: "normalize",
        };
      })
      .filter((item) => item.before.length > 0);
    return { suggestions, confidence: 0.8, warnings: ["normalized"] };
  },
});

export const createExternalProvider = (endpoint?: string, sharedSecret?: string): SpellcheckProvider => ({
  name: "external_api",
  supports: (lang) => lang === "ko",
  check: async (text, context) => {
    if (!endpoint) {
      return { suggestions: [], confidence: 0, warnings: ["service_unconfigured"] };
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sharedSecret) headers["x-spellcheck-secret"] = sharedSecret;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, mode: context.mode, domain: context.domain }),
      signal: context.signal,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.ok === false) {
      return { suggestions: [], confidence: 0, warnings: ["service_error"], raw: payload };
    }
    const suggestions = Array.isArray(payload?.suggestions)
      ? payload.suggestions.map((item: unknown) => {
          const data =
            typeof item === "object" && item !== null
              ? (item as Record<string, unknown>)
              : {};
          const start = data.start;
          const end = data.end;
          const before = data.before;
          const after = data.after;
          const reason = data.reason;
          const confidence = data.confidence;
          const type = data.type;
          return {
            start: typeof start === "number" ? start : Number(start ?? -1),
            end: typeof end === "number" ? end : Number(end ?? -1),
            before: typeof before === "string" ? before : String(before ?? ""),
            after: typeof after === "string" ? after : String(after ?? ""),
            reason: typeof reason === "string" ? reason : "external",
            confidence: clampConfidence(confidence, 0.7),
            type: type ?? classifyByReason(reason ?? "external"),
            source: "external_api",
          };
        })
      : [];
    return {
      suggestions: suggestions.filter((s: ProviderSuggestion) => s.start >= 0 && s.end >= s.start),
      confidence: 0.85,
      warnings: Array.isArray(payload?.warnings) ? payload.warnings : undefined,
      raw: payload,
    };
  },
});

export const createMorphologyProvider = (): SpellcheckProvider => ({
  name: "morphology",
  supports: (lang) => lang === "ko",
  check: async () => {
    let loader: ((id: string) => unknown) | null = null;
    try {
      loader = (0, eval)("require");
    } catch {
      loader = null;
    }
    if (!loader) {
      return {
        suggestions: [],
        confidence: 0,
        warnings: ["morphology_unavailable"],
      };
    }
    try {
      loader("open-korean-text");
      return {
        suggestions: [],
        confidence: 0,
        warnings: ["morphology_not_implemented"],
      };
    } catch {
      return {
        suggestions: [],
        confidence: 0,
        warnings: ["morphology_unavailable"],
      };
    }
  },
});
