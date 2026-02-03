import type { RuleEntry } from "./types";

const r = (pattern: RegExp, replace: string, reason: string, confidence = 0.7): RuleEntry => ({
  pattern: pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`),
  replace,
  reason,
  confidence,
  type: "foreign",
});

export const FOREIGN_NUMBER_RULES: RuleEntry[] = [
  r(/(\d+)\s+(kg|g|mg|cm|mm|m|km|km\/h|m\/s|hz|khz|mhz|ghz|kb|mb|gb|tb)\b/gi, "$1$2", "숫자-단위 표기"),
  r(/(\d+)\s+(시간|분|초|일|주|개월|년)\b/g, "$1$2", "숫자-단위 표기"),
  r(/(\d+)\s+(%|％)/g, "$1$2", "퍼센트 표기"),
  r(/(\d+)\s+(℃|°C|도)\b/gi, "$1$2", "온도 표기"),
  r(/(\d+)\s+(명|개|곡|회|차|번)\b/g, "$1$2", "수량 표기"),
  r(/(\d+)\s+(시|분|초)\s*(\d+)\s*(분|초)/g, "$1$2 $3$4", "시간 표기 정리", 0.6),
  r(/\bEP\s*앨범\b/gi, "EP 앨범", "영문 약어 표기"),
  r(/\bLP\s*앨범\b/gi, "LP 앨범", "영문 약어 표기"),
  r(/\bMV\s*영상\b/gi, "MV 영상", "영문 약어 표기"),
  r(/\bDolby\s*Atmos\b/gi, "Dolby Atmos", "음원 포맷 표기"),
  r(/\bHi[- ]?Res\b/gi, "Hi-Res", "음원 포맷 표기"),
  r(/\b24\s*bit\b/gi, "24bit", "비트 표기"),
  r(/\b96\s*kHz\b/gi, "96kHz", "샘플링 레이트 표기"),
];
