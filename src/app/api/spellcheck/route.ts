import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

type SpellcheckRequest = {
  text?: string;
};

type MatchItem = {
  offset: number;
  length: number;
  replacements?: Array<{ value?: string }>;
};

type SpellcheckTerm = {
  from_text: string;
  to_text: string;
  language: string | null;
};

export const runtime = "nodejs";

const basicCorrections: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /됬/g, replace: "됐" },
  { pattern: /됫/g, replace: "됐" },
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

const normalizeText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildCustomRules = (terms: SpellcheckTerm[]) =>
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
    .filter(Boolean) as Array<{ pattern: RegExp; replace: string }>;

const applyReplacementRules = (
  text: string,
  rules: Array<{ pattern: RegExp; replace: string }>,
) => {
  let corrected = text;
  const changes: Array<{ before: string; after: string }> = [];

  rules.forEach((rule) => {
    const matches = Array.from(corrected.matchAll(rule.pattern));
    if (!matches) return;
    corrected = corrected.replace(rule.pattern, rule.replace);
    matches.forEach((match) => {
      const before = match[0];
      if (!before) return;
      changes.push({ before, after: rule.replace });
    });
  });

  return { corrected, changes };
};

const applyLanguageTool = async (text: string) => {
  const params = new URLSearchParams();
  params.set("language", "ko");
  params.set("text", text);

  const response = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "OnsideSpellcheck/1.0",
      Accept: "application/json",
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    return { corrected: text, changes: [] };
  }

  const payload = (await response.json()) as { matches?: MatchItem[] };
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const usable = matches
    .filter((match) => (match.replacements ?? []).length > 0)
    .sort((a, b) => b.offset - a.offset);

  let corrected = text;
  const changes: Array<{ before: string; after: string }> = [];

  usable.forEach((match) => {
    const before = text.slice(match.offset, match.offset + match.length);
    const replacement = match.replacements?.[0]?.value ?? "";
    if (!replacement) return;
    corrected =
      corrected.slice(0, match.offset) +
      replacement +
      corrected.slice(match.offset + match.length);
    changes.push({ before, after: replacement });
  });

  return { corrected, changes: changes.reverse() };
};

const loadCustomTerms = async () => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("spellcheck_terms")
    .select("from_text, to_text, language")
    .eq("is_active", true);

  if (error || !data) return [];
  return data;
};

export async function POST(request: Request) {
  let originalText = "";
  try {
    const body = (await request.json()) as SpellcheckRequest;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    originalText = text;
    if (!text) {
      return NextResponse.json({ corrected: "", changes: [] });
    }

    const [customTerms, languageToolResult] = await Promise.all([
      loadCustomTerms(),
      applyLanguageTool(text),
    ]);

    const replacementRules = [
      ...buildCustomRules(customTerms),
      ...basicCorrections,
    ];

    let corrected = languageToolResult.corrected;
    let changes = [...languageToolResult.changes];

    const replacementResult = applyReplacementRules(
      corrected,
      replacementRules,
    );
    corrected = replacementResult.corrected;
    changes = [...changes, ...replacementResult.changes];

    const normalized = normalizeText(corrected);
    if (normalized !== corrected) {
      corrected = normalized;
    }

    return NextResponse.json({ corrected, changes });
  } catch (error) {
    console.error(error);
    const customTerms = await loadCustomTerms();
    const replacementRules = [
      ...buildCustomRules(customTerms),
      ...basicCorrections,
    ];
    const fallback = applyReplacementRules(originalText, replacementRules);
    const normalized = normalizeText(fallback.corrected);
    return NextResponse.json({
      corrected: normalized,
      changes: fallback.changes,
    });
  }
}
