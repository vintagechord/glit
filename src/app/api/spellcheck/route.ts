import { NextResponse } from "next/server";
import { KO_SPELLCHECK_RULES, Rule } from "@/lib/spellcheck/rules_ko";

type Suggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason: string;
  confidence: number;
};

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReplacementOnce(before: string, rule: Rule): string | null {
  const flags = rule.pattern.flags.replace("g", "");
  const once = new RegExp(rule.pattern.source, flags);
  const m = once.exec(before);
  if (!m) return null;
  return before.replace(once, rule.replace);
}

function collectMatches(text: string, rule: Rule): Suggestion[] {
  const out: Suggestion[] = [];
  const pattern = rule.pattern.flags.includes("g")
    ? rule.pattern
    : new RegExp(rule.pattern.source, rule.pattern.flags + "g");

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const start = m.index;
    const before = m[0];
    const after = applyReplacementOnce(before, rule);
    if (!after || after === before) continue;

    out.push({
      start,
      end: start + before.length,
      before,
      after,
      reason: rule.reason,
      confidence: rule.confidence ?? 0.8,
    });

    if (pattern.lastIndex === start) pattern.lastIndex = start + 1;
  }
  return out;
}

function dedupeAndResolveOverlaps(items: Suggestion[]): Suggestion[] {
  const bestByRange = new Map<string, Suggestion>();
  for (const s of items) {
    if (s.start < 0 || s.end > Number.MAX_SAFE_INTEGER || s.end <= s.start) continue;
    const key = `${s.start}:${s.end}`;
    const current = bestByRange.get(key);
    if (!current || s.confidence > current.confidence) {
      bestByRange.set(key, s);
      continue;
    }
    if (current && s.confidence === current.confidence) {
      const currentDelta = Math.abs(current.after.length - current.before.length);
      const nextDelta = Math.abs(s.after.length - s.before.length);
      if (nextDelta < currentDelta) {
        bestByRange.set(key, s);
      }
    }
  }

  const seen = new Set<string>();
  const unique: Suggestion[] = [];
  for (const s of bestByRange.values()) {
    const key = `${s.start}:${s.end}:${s.after}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  unique.sort((a, b) => {
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (lb !== la) return lb - la;
    return a.start - b.start;
  });

  const accepted: Suggestion[] = [];
  const occupied: Array<[number, number]> = [];

  const overlaps = (aStart: number, aEnd: number) => {
    for (const [s, e] of occupied) {
      if (aStart < e && aEnd > s) return true;
    }
    return false;
  };

  for (const s of unique) {
    if (overlaps(s.start, s.end)) continue;
    accepted.push(s);
    occupied.push([s.start, s.end]);
  }

  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";

    if (!text) {
      return NextResponse.json({ error: "TEXT_REQUIRED" }, { status: 400 });
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "EMPTY_TEXT" }, { status: 400 });
    }

    if (text.length > 10000) {
      return NextResponse.json({ error: "TEXT_TOO_LARGE", receivedLength: text.length }, { status: 413 });
    }

    const all: Suggestion[] = [];
    for (const rule of KO_SPELLCHECK_RULES) {
      all.push(...collectMatches(text, rule));
      if (all.length >= 800) break;
    }

    const suggestions = dedupeAndResolveOverlaps(all).slice(0, 200);

    return NextResponse.json({
      provider: "rules",
      original: text,
      receivedLength: text.length,
      suggestionCount: suggestions.length,
      suggestions,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        provider: "rules",
        original: "",
        receivedLength: 0,
        suggestionCount: 0,
        suggestions: [],
        error: "SPELLCHECK_INTERNAL_ERROR",
        detail: { message: e?.message ?? String(e) },
      },
      { status: 200 },
    );
  }
}
