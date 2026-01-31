export type HybridChange = {
  start: number;
  end: number;
  before: string;
  after: string;
  rule: string;
  confidence: number;
};

export type HybridOptions = {
  enableNormalization?: boolean;
  enableSpelling?: boolean;
  enableSpacing?: boolean;
  enableParticles?: boolean;
  enablePunctuation?: boolean;
  confidenceThreshold?: number;
  maxIterations?: number;
};

const DEFAULT_OPTIONS: Required<HybridOptions> = {
  enableNormalization: true,
  enableSpelling: true,
  enableSpacing: true,
  enableParticles: true,
  enablePunctuation: true,
  confidenceThreshold: 0.6,
  maxIterations: 5,
};

type Rule = {
  id: string;
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
  confidence: number;
};

const spellingRules: Rule[] = [
  { id: "spell_있엇다", pattern: /있엇다/g, replace: "있었다", confidence: 0.95 },
  { id: "spell_울엇다", pattern: /울엇다/g, replace: "울었다", confidence: 0.95 },
  { id: "spell_몰랏다", pattern: /몰랏다/g, replace: "몰랐다", confidence: 0.95 },
  { id: "spell_끝낫다", pattern: /끝낫다/g, replace: "끝났다", confidence: 0.95 },
  { id: "spell_헷갈렷다", pattern: /헷갈렷다/g, replace: "헷갈렸다", confidence: 0.95 },
  { id: "spell_웃엇다", pattern: /웃엇다/g, replace: "웃었다", confidence: 0.95 },
  { id: "spell_누웟다", pattern: /누웟다/g, replace: "누웠다", confidence: 0.95 },
  { id: "spell_괜찬아진", pattern: /괜찬아진/g, replace: "괜찮아진", confidence: 0.95 },
  { id: "spell_슬퍼보엿다", pattern: /슬퍼보엿다/g, replace: "슬퍼보였다", confidence: 0.9 },
  { id: "spell_이유없는_붙임", pattern: /이유없는/g, replace: "이유 없는", confidence: 0.9 },
  { id: "spell_걸엇다", pattern: /걸엇다/g, replace: "걸었다", confidence: 0.9 },
  { id: "spell_안했", pattern: /안했/g, replace: "안 했", confidence: 0.85 },
  { id: "spell_싫은거야", pattern: /싫은거야/g, replace: "싫은 거야", confidence: 0.9 },
  { id: "spell_가벼운거", pattern: /가벼운거/g, replace: "가벼운 것", confidence: 0.85 },
  { id: "spell_몇개", pattern: /몇개/g, replace: "몇 개", confidence: 0.9 },
  { id: "spell_웃음이엿다", pattern: /웃음이엿다/g, replace: "웃음이었다", confidence: 0.9 },
  { id: "spell_기분이엿다", pattern: /기분이엿다/g, replace: "기분이었다", confidence: 0.9 },
  { id: "spell_쎄게", pattern: /쎄게/g, replace: "세게", confidence: 0.9 },
  { id: "spell_잇", pattern: /잇/g, replace: "있", confidence: 0.8 },
  // 기존 기본 규칙 일부 재사용
  { id: "spell_됫", pattern: /됫/g, replace: "됐", confidence: 0.8 },
  { id: "spell_되요", pattern: /되요/g, replace: "돼요", confidence: 0.85 },
  { id: "spell_되서", pattern: /되서/g, replace: "돼서", confidence: 0.85 },
  { id: "spell_안되", pattern: /안되/g, replace: "안 돼", confidence: 0.8 },
];

const spacingRules: Rule[] = [
  { id: "space_비가오", pattern: /비가[ \t]?오/g, replace: "비가 오", confidence: 0.8 },
  { id: "space_안가지고", pattern: /안가지고/g, replace: "안 가지고", confidence: 0.8 },
  { id: "space_왜그랬는지", pattern: /왜그랬는지/g, replace: "왜 그랬는지", confidence: 0.8 },
  { id: "space_어릴때", pattern: /어릴때/g, replace: "어릴 때", confidence: 0.9 },
  { id: "space_비오는날", pattern: /비오는날/g, replace: "비 오는 날", confidence: 0.9 },
  { id: "space_복잡한줄", pattern: /복잡한줄/g, replace: "복잡한 줄", confidence: 0.9 },
  { id: "space_학교가고", pattern: /학교가고/g, replace: "학교 가고", confidence: 0.8 },
  { id: "space_밥먹고", pattern: /밥먹고/g, replace: "밥 먹고", confidence: 0.8 },
  { id: "space_뭘하고", pattern: /뭘하고/g, replace: "뭘 하고", confidence: 0.8 },
  { id: "space_잘살고", pattern: /잘살고/g, replace: "잘 살고", confidence: 0.8 },
  { id: "space_살아만", pattern: /살아만/g, replace: "살아만", confidence: 0.6 },
  { id: "space_안한채", pattern: /안한채/g, replace: "안 한 채", confidence: 0.9 },
  { id: "space_그냥발이", pattern: /그냥[ \t]?발이/g, replace: "그냥 발이", confidence: 0.7 },
  { id: "space_걷고잇엇다", pattern: /걷고잇엇다/g, replace: "걷고 있었다", confidence: 0.9 },
  { id: "space_걷고있었다", pattern: /걷고있었다/g, replace: "걷고 있었다", confidence: 0.9 },
  { id: "space_눈이좀", pattern: /눈이[ \t]?좀/g, replace: "눈이 좀", confidence: 0.7 },
  { id: "space_더쎄게", pattern: /더[ \t]?세게/g, replace: "더 세게", confidence: 0.8 },
  { id: "space_야옹하고", pattern: /야옹[ \t]+하고/g, replace: "야옹하고", confidence: 0.85 },
  { id: "space_왜그랬는지2", pattern: /왜[ \t]?그랬는지/g, replace: "왜 그랬는지", confidence: 0.8 },
  { id: "space_안했지만", pattern: /안[ \t]?했지만/g, replace: "안 했지만", confidence: 0.9 },
  { id: "space_싫은거야2", pattern: /싫은[ \t]?거야/g, replace: "싫은 거야", confidence: 0.9 },
  { id: "space_있는걸까", pattern: /있는걸까/g, replace: "있는 걸까", confidence: 0.85 },
  { id: "space_있는건지", pattern: /있는건지/g, replace: "있는 건지", confidence: 0.85 },
  { id: "space_올거라고", pattern: /올거라고/g, replace: "올 거라고", confidence: 0.85 },
];

const particleRules: Rule[] = [
  { id: "particle_한테", pattern: /([가-힣]+)\s+(한테)/g, replace: "$1$2", confidence: 0.9 },
  { id: "particle_에게", pattern: /([가-힣]+)\s+(에게)/g, replace: "$1$2", confidence: 0.9 },
  { id: "particle_께", pattern: /([가-힣]+)\s+(께)/g, replace: "$1$2", confidence: 0.9 },
];

const auxiliaryRules: Rule[] = [
  { id: "aux_보였다", pattern: /([가-힣]+)보였다/g, replace: "$1 보였다", confidence: 0.85 },
  { id: "aux_보인다", pattern: /([가-힣]+)보인다/g, replace: "$1 보인다", confidence: 0.8 },
  { id: "aux_보이고", pattern: /([가-힣]+)보이고/g, replace: "$1 보이고", confidence: 0.8 },
  { id: "aux_보였다2", pattern: /보엿다/g, replace: "보였다", confidence: 0.85 },
];

const punctuationRules: Rule[] = [
  { id: "punc_quote", pattern: /[“”]/g, replace: '"', confidence: 0.6 },
  { id: "punc_single_quote", pattern: /[’‘]/g, replace: "'", confidence: 0.6 },
  { id: "punc_double_space", pattern: /[ \t]{2,}/g, replace: " ", confidence: 0.6 },
];

const normalize = (text: string) => {
  let normalized = typeof text.normalize === "function" ? text.normalize("NFC") : text;
  normalized = normalized.replace(/\r\n?/g, "\n");
  normalized = normalized.replace(/[“”]/g, '"').replace(/[’‘]/g, "'");
  normalized = normalized.replace(/[ \t]+/g, (m) => (m.includes("\n") ? m : " "));
  return normalized;
};

const applyRules = (
  text: string,
  rules: Rule[],
  options: Required<HybridOptions>,
): { text: string; changes: HybridChange[] } => {
  let output = text;
  const changes: HybridChange[] = [];

  rules.forEach((rule) => {
    const pattern = rule.pattern.global
      ? rule.pattern
      : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    output = output.replace(pattern, (match, ...args) => {
      const index = args[args.length - 2] as number;
      const before = match;
      const after =
        typeof rule.replace === "function"
          ? rule.replace(match, ...(args as string[]))
          : match.replace(rule.pattern, rule.replace);
      if (rule.confidence >= options.confidenceThreshold) {
        changes.push({
          start: index,
          end: index + before.length,
          before,
          after,
          rule: rule.id,
          confidence: rule.confidence,
        });
        return after;
      }
      return match;
    });
  });

  return { text: output, changes };
};

export const runHybridSpellcheck = (text: string, userOptions?: HybridOptions) => {
  const options: Required<HybridOptions> = { ...DEFAULT_OPTIONS, ...(userOptions ?? {}) };

  let working = options.enableNormalization ? normalize(text) : text;
  const allChanges: HybridChange[] = [];

  const steps: Array<{ enabled: boolean; rules: Rule[] }> = [
    { enabled: options.enableSpelling, rules: spellingRules },
    { enabled: options.enableSpacing, rules: spacingRules },
    { enabled: options.enableParticles, rules: [...particleRules, ...auxiliaryRules] },
    { enabled: options.enablePunctuation, rules: punctuationRules },
  ];

  for (let iter = 0; iter < options.maxIterations; iter += 1) {
    let iterChanges = 0;
    steps.forEach((step) => {
      if (!step.enabled) return;
      const { text: next, changes } = applyRules(working, step.rules, options);
      if (changes.length) {
        iterChanges += changes.length;
        allChanges.push(
          ...changes.map((change) => ({
            ...change,
            rule: `${change.rule}#${iter + 1}`,
          })),
        );
        working = next;
      }
    });
    if (iterChanges === 0) break;
  }

  return { corrected: working, changes: allChanges };
};
