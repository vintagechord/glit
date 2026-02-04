import dictionary from "../../../config/spellcheck_dictionary.json";

type DictionaryReplacement = {
  from: string;
  to: string;
  reason?: string;
  confidence?: number;
  language?: "KO" | "EN";
};

type DictionaryPayload = {
  protected?: string[];
  replacements?: DictionaryReplacement[];
};

const payload = dictionary as DictionaryPayload;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeList = (values: Array<string | undefined | null>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const envProtectedTerms = (process.env.SPELLCHECK_PROTECTED_TERMS ?? "")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);

export const protectedTerms = normalizeList([
  ...(payload.protected ?? []),
  ...envProtectedTerms,
]);

export const dictionaryRules = (payload.replacements ?? [])
  .map((entry) => {
    const from = entry.from?.trim();
    const to = entry.to?.trim();
    if (!from || !to) return null;
    const language = (entry.language ?? "KO").toUpperCase();
    const escaped = escapeRegExp(from);
    const isAsciiWord = /^[A-Za-z0-9._-]+$/.test(from);
    const pattern =
      language === "EN" || isAsciiWord
        ? new RegExp(`\\b${escaped}\\b`, "gi")
        : new RegExp(escaped, "g");
    return {
      pattern,
      replace: to,
      reason: entry.reason ?? "dictionary_rule",
      confidence: entry.confidence ?? 0.9,
    };
  })
  .filter(Boolean) as Array<{
  pattern: RegExp;
  replace: string;
  reason: string;
  confidence: number;
}>;

export const buildProtectedTermPatterns = () => {
  return protectedTerms.map((term) => {
    const escaped = escapeRegExp(term);
    const isAsciiWord = /^[A-Za-z0-9._-]+$/.test(term);
    const pattern = isAsciiWord ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "g");
    return { term, pattern };
  });
};
