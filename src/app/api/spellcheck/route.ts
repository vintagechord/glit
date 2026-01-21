import { NextResponse } from "next/server";

export const runtime = "nodejs";

type IncomingBody = { text?: string };

type LlmSuggestion = {
  before: string;
  after: string;
  reason?: string;
  anchor_before?: string;
  anchor_after?: string;
  confidence?: number;
};

type LlmResponse = {
  suggestions: LlmSuggestion[];
};

type OutSuggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason?: string;
  confidence?: number;
};

const MAX_LEN = 10_000;

function jsonError(status: number, error: string, detail?: unknown) {
  return NextResponse.json({ error, detail }, { status });
}

function safeSnippet(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

/**
 * Find a unique match for a suggestion using anchors.
 * Returns [start,end] (end exclusive) for the `before` portion within the best matched anchor.
 * If ambiguous, returns null (safety first).
 */
function matchWithAnchors(
  original: string,
  before: string,
  anchorBefore?: string,
  anchorAfter?: string,
): { start: number; end: number } | null {
  const ab = anchorBefore ?? "";
  const aa = anchorAfter ?? "";
  const full = ab + before + aa;

  // 1) full anchor unique match
  if (full.length > 0) {
    const first = original.indexOf(full);
    if (first !== -1) {
      const second = original.indexOf(full, first + 1);
      if (second === -1) {
        const start = first + ab.length;
        return { start, end: start + before.length };
      }
    }
  }

  // 2) partial anchors
  const left = ab + before;
  if (ab && left.length > 0) {
    const first = original.indexOf(left);
    if (first !== -1) {
      const second = original.indexOf(left, first + 1);
      if (second === -1) {
        const start = first + ab.length;
        return { start, end: start + before.length };
      }
    }
  }

  const right = before + aa;
  if (aa && right.length > 0) {
    const first = original.indexOf(right);
    if (first !== -1) {
      const second = original.indexOf(right, first + 1);
      if (second === -1) {
        const start = first;
        return { start, end: start + before.length };
      }
    }
  }

  // 3) before only — must be unique, otherwise ambiguous (drop)
  const first = original.indexOf(before);
  if (first !== -1) {
    const second = original.indexOf(before, first + 1);
    if (second === -1) {
      return { start: first, end: first + before.length };
    }
  }

  return null;
}

function dedupeAndResolveConflicts(items: OutSuggestion[]): OutSuggestion[] {
  // sort by start asc, then longer first, then confidence desc
  const sorted = [...items].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    const ca = a.confidence ?? 0;
    const cb = b.confidence ?? 0;
    return cb - ca;
  });

  const result: OutSuggestion[] = [];
  for (const s of sorted) {
    const last = result[result.length - 1];
    if (!last) {
      result.push(s);
      continue;
    }
    // overlap?
    if (s.start < last.end) {
      const lenS = s.end - s.start;
      const lenL = last.end - last.start;
      const cs = s.confidence ?? 0;
      const cl = last.confidence ?? 0;

      const keepNew = cs > cl || (cs === cl && lenS > lenL);
      if (keepNew) result[result.length - 1] = s;
      // else drop s
    } else {
      result.push(s);
    }
  }
  return result;
}

async function callOpenAiSpellcheck(text: string): Promise<LlmResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const system =
    '너는 한국어 맞춤법/띄어쓰기 교정 도우미다. 원문 전체를 재작성하지 말고 "부분 교체 제안"만 만들어라. 반드시 JSON만 출력한다. JSON 외 텍스트 금지.';

  const user = `
다음 텍스트에서 맞춤법/띄어쓰기/표준 표기만 최소한으로 고치기 위한 "부분 교체 제안"을 JSON으로 출력하라.
요구:
- suggestions 0~30개
- 각 suggestion: before/after/reason/anchor_before/anchor_after/confidence
- before는 입력 텍스트에 그대로 존재하는 연속 문자열이어야 한다(정확 일치)
- anchor_before/anchor_after는 before 앞뒤 문맥(각각 5~30자)으로, 가능하면 원문에서 유일 매칭되게 선택
- 문체/의미를 바꾸지 말고 과도한 윤문 금지
반드시 아래 스키마를 지켜라:
{
  "suggestions": [
    {
      "before": "...",
      "after": "...",
      "reason": "...",
      "anchor_before": "...",
      "anchor_after": "...",
      "confidence": 0.0
    }
  ]
}
텍스트:
<<<${text}>>>`.trim();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${safeSnippet(t, 500)}`);
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI returned empty content");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse OpenAI JSON content");
  }

  if (!parsed || !Array.isArray(parsed.suggestions)) {
    throw new Error("OpenAI JSON missing suggestions array");
  }

  return { suggestions: parsed.suggestions as LlmSuggestion[] };
}

export async function POST(req: Request) {
  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return jsonError(400, "INVALID_JSON");
  }

  const text = body.text;
  if (typeof text !== "string") return jsonError(400, "TEXT_REQUIRED");
  if (text.trim().length === 0) return jsonError(400, "EMPTY_TEXT");
  if (text.length > MAX_LEN) return jsonError(413, "TEXT_TOO_LARGE", { max: MAX_LEN });

  try {
    const llm = await callOpenAiSpellcheck(text);

    const mapped: OutSuggestion[] = [];
    for (const s of llm.suggestions) {
      if (!s || typeof s.before !== "string" || typeof s.after !== "string") continue;
      if (!s.before || s.before === s.after) continue;

      const range = matchWithAnchors(text, s.before, s.anchor_before, s.anchor_after);
      if (!range) continue; // ambiguous or not found -> drop for safety

      mapped.push({
        start: range.start,
        end: range.end,
        before: s.before,
        after: s.after,
        reason: s.reason,
        confidence: typeof s.confidence === "number" ? s.confidence : undefined,
      });
    }

    const finalSuggestions = dedupeAndResolveConflicts(mapped);

    return NextResponse.json(
      {
        original: text,
        receivedLength: text.length,
        provider: "openai",
        suggestions: finalSuggestions,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return jsonError(502, "SPELLCHECK_PROVIDER_FAILED", {
      message: e?.message ?? String(e),
    });
  }
}
