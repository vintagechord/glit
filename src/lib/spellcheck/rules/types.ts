import type { SuggestionType } from "../types";

export type RuleEntry = {
  pattern: RegExp;
  replace: string;
  reason: string;
  confidence?: number;
  type?: SuggestionType;
};
