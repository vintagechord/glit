export type Rule = {
  pattern: RegExp;
  replace: string;
  reason: string;
  confidence?: number;
};

const defaultConfidence = 0.8;

export const spellcheckRules: Rule[] = [
  { pattern: /싫엇/g, replace: "싫었", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /있엇/g, replace: "있었", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /이엇/g, replace: "이었", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /됬/g, replace: "됐", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /됫/g, replace: "됐", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /되요/g, replace: "돼요", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /되서/g, replace: "돼서", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /되있/g, replace: "돼 있", reason: "맞춤법", confidence: 0.6 },
  { pattern: /할수/g, replace: "할 수", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /알수/g, replace: "알 수", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /볼수/g, replace: "볼 수", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /있을수/g, replace: "있을 수", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /될거/g, replace: "될 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /없을거/g, replace: "없을 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /될꺼/g, replace: "될 거", reason: "띄어쓰기", confidence: 0.6 },
  { pattern: /할꺼/g, replace: "할 거", reason: "띄어쓰기", confidence: 0.6 },
  { pattern: /할께/g, replace: "할게", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /드릴께/g, replace: "드릴게", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /해볼께/g, replace: "해볼게", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /하는거/g, replace: "하는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /있는거/g, replace: "있는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /같은거/g, replace: "같은 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /되는거/g, replace: "되는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /먹는거/g, replace: "먹는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /보는거/g, replace: "보는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /듣는거/g, replace: "듣는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /쓰는거/g, replace: "쓰는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /인거/g, replace: "인 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /거같/g, replace: "것 같", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /것같/g, replace: "것 같", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /놀리는거/g, replace: "놀리는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /할려고/g, replace: "하려고", reason: "맞춤법", confidence: 0.7 },
  { pattern: /하려고해/g, replace: "하려고 해", reason: "띄어쓰기", confidence: 0.7 },
  { pattern: /어떡해/g, replace: "어떻게", reason: "맞춤법(문맥 주의)", confidence: 0.4 },
  { pattern: /안되/g, replace: "안 돼", reason: "맞춤법(문맥 주의)", confidence: 0.5 },
  { pattern: /안돼다/g, replace: "안 되다", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /안대/g, replace: "안 돼", reason: "맞춤법", confidence: 0.5 },
  { pattern: /웬지/g, replace: "왠지", reason: "맞춤법", confidence: 0.6 },
  { pattern: /왠만/g, replace: "웬만", reason: "맞춤법", confidence: 0.6 },
  { pattern: /됬어/g, replace: "됐어", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /됬다/g, replace: "됐다", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /됐엇/g, replace: "됐었", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /뭔가요/g, replace: "무엇인가요", reason: "표준어", confidence: 0.4 },
  { pattern: /이렇케/g, replace: "이렇게", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /저렇케/g, replace: "저렇게", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /그렇케/g, replace: "그렇게", reason: "맞춤법", confidence: defaultConfidence },
  { pattern: /거같아/g, replace: "것 같아", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /거같은/g, replace: "것 같은", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /있을꺼/g, replace: "있을 거", reason: "띄어쓰기", confidence: 0.6 },
  { pattern: /없는거/g, replace: "없는 거", reason: "띄어쓰기", confidence: defaultConfidence },
  { pattern: /같았엇/g, replace: "같았었", reason: "맞춤법", confidence: defaultConfidence },
];

export function applyRuleSuggestions(text: string) {
  const suggestions: Array<{
    start: number;
    end: number;
    before: string;
    after: string;
    reason: string;
    confidence?: number;
  }> = [];

  spellcheckRules.forEach((rule) => {
    const pattern = rule.pattern.global
      ? rule.pattern
      : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (!match[0]) continue;
      const start = match.index ?? -1;
      if (start < 0) continue;
      const end = start + match[0].length;
      const after = match[0].replace(rule.pattern, rule.replace);
      if (after === match[0]) continue;
      suggestions.push({
        start,
        end,
        before: match[0],
        after,
        reason: rule.reason,
        confidence: rule.confidence ?? defaultConfidence,
      });
    }
  });

  return suggestions;
}
