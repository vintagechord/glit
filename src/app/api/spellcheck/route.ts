import { NextResponse } from "next/server";

import {
  basicCorrections,
  buildCustomRules,
  spellcheckText,
  type SpellcheckChange,
  type SpellcheckTerm,
} from "@/lib/spellcheck";
import { createServerSupabase } from "@/lib/supabase/server";

export interface SpellcheckRequest {
  text: string;
}

export type SpellcheckSuggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason?: string;
};

export interface SpellcheckResponse {
  original: string;
  correctedText: string;
  suggestions: SpellcheckSuggestion[];
  receivedLength?: number;
  changes?: SpellcheckChange[];
  raw?: unknown;
  truncated?: boolean;
}

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 10000;

const buildSuggestionsFromChanges = (
  changes: SpellcheckChange[],
): SpellcheckSuggestion[] =>
  changes.map((change) => ({
    start: change.index,
    end: change.index + change.from.length,
    before: change.from,
    after: change.to,
    reason: "rule_basic",
  }));

const loadCustomTerms = async (): Promise<SpellcheckTerm[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("spellcheck_terms")
    .select("from_text, to_text, language")
    .eq("is_active", true);

  if (error || !data) return [];
  return data as SpellcheckTerm[];
};

const spellcheckEngine = async (text: string): Promise<SpellcheckResponse> => {
  const customTerms = await loadCustomTerms();
  const rules = [...buildCustomRules(customTerms), ...basicCorrections];
  const result = spellcheckText(text, rules);
  if (!result.ok) {
    throw new Error(result.error.message ?? "SPELLCHECK_FAILED");
  }
  const suggestions = buildSuggestionsFromChanges(result.changes);
  return {
    original: result.original,
    correctedText: result.corrected,
    suggestions,
    receivedLength: result.original.length,
    changes: result.changes,
    truncated: result.truncated,
    raw: { engine: "rule-basic" },
  } satisfies SpellcheckResponse;
};
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<SpellcheckRequest>;
    const text = typeof body.text === "string" ? body.text : "";

    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: "EMPTY_TEXT", receivedLength: text?.length ?? 0 },
        { status: 400 },
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "TEXT_TOO_LARGE", receivedLength: text.length },
        { status: 413 },
      );
    }

    const result = await spellcheckEngine(text);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Spellcheck failed", error);
    return NextResponse.json(
      { error: "SPELLCHECK_FAILED" },
      { status: 500 },
    );
  }
}
