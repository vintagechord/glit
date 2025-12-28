import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import {
  basicCorrections,
  buildCustomRules,
  spellcheckText,
  type SpellcheckError,
  type SpellcheckTerm,
} from "@/lib/spellcheck";

type SpellcheckRequest = {
  text?: string;
  mode?: string;
};

type SpellcheckApiSuccess = {
  ok: true;
  original: string;
  corrected: string;
  changes: Array<{ from: string; to: string; index: number }>;
  meta: { engine: string; truncated: boolean };
};

export const runtime = "nodejs";

const loadCustomTerms = async (): Promise<SpellcheckTerm[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("spellcheck_terms")
    .select("from_text, to_text, language")
    .eq("is_active", true);

  if (error || !data) return [];
  return data as SpellcheckTerm[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SpellcheckRequest;
    const text = typeof body.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json(spellcheckText(text, []));
    }

    const customTerms = await loadCustomTerms();
    const rules = [...buildCustomRules(customTerms), ...basicCorrections];
    const result = spellcheckText(text, rules);

    if (!result.ok) {
      return NextResponse.json(result);
    }

    const response: SpellcheckApiSuccess = {
      ok: true,
      original: result.original,
      corrected: result.corrected,
      changes: result.changes,
      meta: { engine: "rule-basic", truncated: result.truncated },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Spellcheck failed", error);
    const response: SpellcheckError = {
      ok: false,
      error: {
        code: "SPELLCHECK_FAILED",
        message: "일시적으로 맞춤법 적용에 실패했습니다.",
      },
    };
    return NextResponse.json(response);
  }
}
