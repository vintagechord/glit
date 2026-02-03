import type { RuleEntry } from "./types";

const r = (pattern: RegExp, replace: string, reason: string, confidence = 0.5): RuleEntry => ({
  pattern: pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`),
  replace,
  reason,
  confidence,
  type: "style",
});

export const STYLE_RULES: RuleEntry[] = [
  r(/([!?~])\1{2,}/g, "$1$1", "과도한 반복 부호 정리"),
  r(/([,.])\1{2,}/g, "$1", "과도한 반복 부호 정리"),
  r(/\s*([!?])\s*/g, "$1 ", "문장부호 주변 공백 정리", 0.45),
  r(/\u00A0+/g, " ", "특수 공백 정리", 0.45),
  r(/ㅋㅋㅋㅋ+/g, "ㅋㅋ", "반복 축약 (스타일)", 0.35),
  r(/ㅎㅎㅎㅎ+/g, "ㅎㅎ", "반복 축약 (스타일)", 0.35),
  r(/ㅠㅠㅠ+/g, "ㅠㅠ", "반복 축약 (스타일)", 0.35),
];
