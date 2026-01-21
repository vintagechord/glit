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
    changes: result.changes,
    truncated: result.truncated,
    raw: { engine: "rule-basic" },
  } satisfies SpellcheckResponse;
};
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<SpellcheckRequest>;
    const text = typeof body.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json({
        original: text,
        correctedText: text,
        suggestions: [],
        changes: [],
      } satisfies SpellcheckResponse);
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "텍스트가 너무 깁니다. 10000자 이하로 나누어 적용해주세요." },
        { status: 413 },
      );
    }

    const result = await spellcheckEngine(text);
    return NextResponse.json(result);

    return NextResponse.json(
      { error: "맞춤법 적용에 실패했습니다." },
      { status: 500 },
    );
  } catch (error) {
    console.error("Spellcheck failed", error);
    return NextResponse.json(
      { error: "맞춤법 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}
