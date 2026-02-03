export type SpellcheckMode = "strict" | "balanced" | "fast";
export type SpellcheckDomain = "general" | "music";
export type SpellcheckLanguage = "ko";

export type SuggestionType =
  | "spacing"
  | "orthography"
  | "punctuation"
  | "foreign"
  | "style"
  | "custom";

export type SpellcheckSuggestion = {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
  type: SuggestionType;
  confidence: number;
  message: string;
  source: string;
};

export type SpellcheckDiff = {
  op: "equal" | "insert" | "delete" | "replace";
  a: string;
  b: string;
  indexA: number;
  indexB: number;
};

export type SpellcheckProviderMeta = {
  name: string;
  ok: boolean;
  ms: number;
  warnings?: string[];
};

export type SpellcheckMeta = {
  mode: SpellcheckMode;
  providers: SpellcheckProviderMeta[];
  reasonIfEmpty?: string;
  traceId: string;
  truncated?: boolean;
};

export type SpellcheckResponse = {
  originalText: string;
  normalizedText: string;
  correctedText: string;
  suggestions: SpellcheckSuggestion[];
  diffs: SpellcheckDiff[];
  meta: SpellcheckMeta;
};
