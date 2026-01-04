import { NextResponse } from "next/server";

import {
  basicCorrections,
  buildCustomRules,
  spellcheckText,
  type SpellcheckChange,
  type SpellcheckTerm,
} from "@/lib/spellcheck";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * 부산대 한국어 맞춤법 검사기(PNU Speller) 사용
 * - Endpoint: POST https://speller.cs.pusan.ac.kr/results
 * - Request(body): form-data | x-www-form-urlencoded, field name: text1
 * - Response: HTML 내에 `data = [...]` 형태의 JSON이 포함됨
 *   각 item.errata_info[*].candWord(제안어), orgStr(원문), start/end(위치) 등을 활용해 치환
 */

export interface SpellcheckRequest {
  text: string;
}

export interface SpellcheckResponse {
  correctedText: string;
  changes?: SpellcheckChange[];
  raw?: unknown;
  truncated?: boolean;
}

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 8000;
const PNU_ENDPOINT =
  process.env.PNU_SPELLCHECK_URL ?? "https://speller.cs.pusan.ac.kr/results";

type PnuErratum = {
  start?: number;
  end?: number;
  orgStr?: string;
  candWord?: string;
  help?: string;
};

const parsePnuResponse = (html: string): PnuErratum[] => {
  const match = html.match(/data\s*=\s*(\[[\s\S]*?\]);/);
  if (!match || !match[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    const blocks = Array.isArray(parsed) ? parsed : [];
    const errata: PnuErratum[] = [];
    blocks.forEach((block) => {
      const items = block?.errata_info ?? block?.err_info;
      if (Array.isArray(items)) {
        items.forEach((item) => errata.push(item));
      }
    });
    return errata;
  } catch (error) {
    console.error("Failed to parse PNU spellcheck JSON", error);
    return [];
  }
};

const applyPnuCorrections = (
  text: string,
  errata: PnuErratum[],
): { corrected: string; changes: SpellcheckChange[] } => {
  let corrected = text;
  const changes: SpellcheckChange[] = [];

  const prepared = errata
    .map((item) => {
      const candidate =
        item.candWord
          ?.split(/[,|]/)
          .map((value) => value.trim())
          .find(Boolean) ?? "";
      const start =
        typeof item.start === "number" ? item.start : corrected.indexOf(item.orgStr ?? "");
      const end =
        typeof item.end === "number"
          ? item.end
          : start >= 0 && item.orgStr
            ? start + item.orgStr.length - 1
            : -1;
      return {
        candidate,
        start,
        end,
        original:
          item.orgStr ??
          (start >= 0 && end >= start
            ? corrected.slice(start, end + 1)
            : ""),
      };
    })
    .filter((item) => item.candidate && item.start >= 0 && item.end >= item.start)
    // 뒤에서부터 치환해야 인덱스가 어긋나지 않음
    .sort((a, b) => b.start - a.start);

  prepared.forEach((item) => {
    corrected =
      corrected.slice(0, item.start) +
      item.candidate +
      corrected.slice(item.end + 1);
    changes.push({ from: item.original, to: item.candidate, index: item.start });
  });

  return { corrected, changes };
};

const runPnuSpellcheck = async (
  text: string,
): Promise<SpellcheckResponse | null> => {
  const form = new URLSearchParams();
  form.set("text1", text);

  const response = await fetch(PNU_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`PNU spellcheck failed: ${response.status}`);
  }

  const html = await response.text();
  const errata = parsePnuResponse(html);
  if (!errata.length) {
    return null;
  }

  const { corrected, changes } = applyPnuCorrections(text, errata);
  return { correctedText: corrected, changes, raw: errata };
};

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
    const body = (await request.json().catch(() => ({}))) as Partial<SpellcheckRequest>;
    const text = typeof body.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json(
        { error: "텍스트를 입력해주세요." },
        { status: 400 },
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "텍스트가 너무 깁니다. 8000자 이하로 나누어 적용해주세요." },
        { status: 413 },
      );
    }

    // 1) 외부 PNU 스펠러 시도
    const pnuResult = await runPnuSpellcheck(text).catch((error) => {
      console.error("PNU spellcheck failed", error);
      return null;
    });
    if (pnuResult?.correctedText) {
      return NextResponse.json(pnuResult as SpellcheckResponse);
    }

    // 2) 내부 룰 기반(커스텀 + 기본) 폴백
    const customTerms = await loadCustomTerms();
    const rules = [...buildCustomRules(customTerms), ...basicCorrections];
    const fallback = spellcheckText(text, rules);
    if (fallback.ok) {
      const response: SpellcheckResponse = {
        correctedText: fallback.corrected,
        changes: fallback.changes,
        truncated: fallback.truncated,
        raw: { engine: "rule-basic" },
      };
      return NextResponse.json(response);
    }

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
