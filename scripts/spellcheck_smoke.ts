import * as mod from "../src/lib/spellcheck/rules_ko";

type Rule = { pattern: RegExp; replace: string; reason: string; confidence?: number };
type Suggestion = {
  start: number;
  end: number;
  before: string;
  after: string;
  reason: string;
  confidence: number;
  groupId?: string;
};

type RulesModule = { default?: unknown; KO_SPELLCHECK_RULES?: unknown };
const moduleValue = mod as RulesModule;
const defaultExport = moduleValue.default as RulesModule | Rule[] | undefined;
const resolveRules = (value: unknown): Rule[] | null =>
  Array.isArray(value) && value.length > 0 ? (value as Rule[]) : null;
const RULES: Rule[] =
  resolveRules(
    defaultExport && "KO_SPELLCHECK_RULES" in (defaultExport as object)
      ? (defaultExport as RulesModule).KO_SPELLCHECK_RULES
      : null,
  ) ??
  resolveRules(moduleValue.KO_SPELLCHECK_RULES) ??
  resolveRules(defaultExport) ??
  [];

const SHORT_BEFORE_ALLOW = new Set(["됬", "됫", "됐", "됏", "되야", "그낭", "쫌", "구지", "할려"]);

function applyReplacementOnce(before: string, rule: Rule): string | null {
  const flags = rule.pattern.flags.replace("g", "");
  const once = new RegExp(rule.pattern.source, flags);
  const m = once.exec(before);
  if (!m) return null;
  return before.replace(once, rule.replace);
}

function collectMatches(text: string, rule: Rule, baseOffset = 0): Suggestion[] {
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
      start: start + baseOffset,
      end: start + before.length + baseOffset,
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
    if (s.start < 0 || s.end <= s.start) continue;
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

  const unique: Suggestion[] = Array.from(bestByRange.values());
  unique.sort((a, b) => {
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (lb !== la) return lb - la;
    return a.start - b.start;
  });

  const accepted: Suggestion[] = [];
  let groupSeq = 0;
  const overlaps = (a: Suggestion, b: Suggestion) => a.start < b.end && b.start < a.end;
  const isSpacing = (s: Suggestion) => s.reason.includes("띄어쓰기");

  for (const s of unique) {
    if (s.before.length <= 2 && !SHORT_BEFORE_ALLOW.has(s.before)) continue;

    let skip = false;
    const toRemove: number[] = [];
    let groupId: string | undefined;

    for (let i = 0; i < accepted.length; i++) {
      const a = accepted[i];
      if (!overlaps(a, s)) continue;

      const lenA = a.end - a.start;
      const lenS = s.end - s.start;
      const aContains = a.start <= s.start && a.end >= s.end;
      const sContains = s.start <= a.start && s.end >= a.end;
      const spacingA = isSpacing(a);
      const spacingS = isSpacing(s);

      if (sContains && lenS > lenA) {
        if (s.confidence - a.confidence >= 0.15) {
          toRemove.push(i);
          continue;
        }
        if (!groupId && a.groupId) groupId = a.groupId;
        if (!groupId && !a.groupId) {
          groupSeq += 1;
          groupId = `g${groupSeq}`;
          a.groupId = groupId;
        }
        continue;
      }

      if (aContains && lenA > lenS) {
        if (a.confidence - s.confidence >= 0.15) {
          skip = true;
          break;
        }
        if (!groupId && a.groupId) groupId = a.groupId;
        if (!groupId && !a.groupId) {
          groupSeq += 1;
          groupId = `g${groupSeq}`;
          a.groupId = groupId;
        }
        continue;
      }

      if (spacingA !== spacingS) {
        const diff = s.confidence - a.confidence;
        if (Math.abs(diff) >= 0.15) {
          if (diff > 0) {
            toRemove.push(i);
            continue;
          } else {
            skip = true;
            break;
          }
        } else {
          if (!groupId && a.groupId) groupId = a.groupId;
          if (!groupId && !a.groupId) {
            groupSeq += 1;
            groupId = `g${groupSeq}`;
            a.groupId = groupId;
          }
          continue;
        }
      }

      const diffConf = Math.abs(s.confidence - a.confidence);
      if (diffConf < 0.2) {
        if (!groupId && a.groupId) groupId = a.groupId;
        if (!groupId && !a.groupId) {
          groupSeq += 1;
          groupId = `g${groupSeq}`;
          a.groupId = groupId;
        }
        continue;
      }

      if (s.confidence > a.confidence + 0.01 || lenS > lenA) {
        toRemove.push(i);
      } else {
        skip = true;
        break;
      }
    }

    if (skip) continue;
    if (groupId) s.groupId = groupId;
    if (toRemove.length) {
      toRemove.sort((a, b) => b - a);
      for (const idx of toRemove) accepted.splice(idx, 1);
    }
    accepted.push(s);
  }

  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

type Case = { name: string; text: string; min: number };

const cases: Case[] = [
  {
    name: "lyrics-board",
    text:
      "오늘은 왠지 기분이 이상햇다. 아침에 눈을 떴을 때 부터 마음이 좀 찝찝했어. 너한테 연락하려고 했는데 그냥 참앗다. 오랜만에 만난 친구가 웃엇다. 이거 오늘안에 꼭 되야해. 하루 종일 나갈까하다가 포기햇다. 집에 돌아와서도 할 수있는게 없어서 쉬고싶다. 보고싶은데도 못봤어. 그랬던것 같아.",
    min: 12,
  },
  {
    name: "typo-short",
    text: "그낭 걸엇어.",
    min: 2,
  },
  {
    name: "informal-typos",
    text: "쫌 구지 할려면 될려고 하지마.",
    min: 3,
  },
];

function runCase(c: Case) {
  let all: Suggestion[] = [];
  for (const rule of RULES) {
    all = all.concat(collectMatches(c.text, rule));
    if (all.length > 1000) break;
  }
  const suggestions = dedupeAndResolveOverlaps(all);
  console.log(`[spellcheck-smoke] ${c.name} suggestions=${suggestions.length}`);
  if (suggestions.length < c.min) {
    console.error(`[spellcheck-smoke] FAIL: ${c.name} expected >=${c.min}, got ${suggestions.length}`);
    process.exitCode = 1;
  }
  console.log(
    JSON.stringify(
      suggestions.slice(0, 12).map((s) => ({ before: s.before, after: s.after, reason: s.reason, conf: s.confidence })),
      null,
      2,
    ),
  );
}

function main() {
  if (!Array.isArray(RULES) || !RULES.length) {
    console.error("Rules not loaded");
    process.exit(1);
  }
  for (const c of cases) runCase(c);
}

main();
