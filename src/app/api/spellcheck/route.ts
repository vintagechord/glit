import { NextResponse } from "next/server";

import { applyRuleSuggestions } from "@/lib/spellcheck-rules";

export const runtime = "nodejs";

type IncomingBody = { text?: string };

type OutSuggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason: string;
  confidence?: number;
};

const MAX_LEN = 10_000;

function jsonError(status: number, error: string, detail?: unknown) {
  return NextResponse.json({ error, detail }, { status });
}

function dedupeSuggestions(list: OutSuggestion[]): OutSuggestion[] {
  const sorted = [...list].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const ca = a.confidence ?? 0;
    const cb = b.confidence ?? 0;
    if (ca !== cb) return cb - ca;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    return a.reason.localeCompare(b.reason);
  });

  const result: OutSuggestion[] = [];
  for (const s of sorted) {
    const overlap = result.some(
      (r) => Math.max(r.start, s.start) < Math.min(r.end, s.end),
    );
    if (!overlap) result.push(s);
  }
  return result;
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

  const rawSuggestions = applyRuleSuggestions(text);
  const suggestions = dedupeSuggestions(rawSuggestions);

  return NextResponse.json(
    {
      original: text,
      correctedText: text,
      receivedLength: text.length,
      provider: "rules",
      suggestions,
    },
    { status: 200 },
  );
}
