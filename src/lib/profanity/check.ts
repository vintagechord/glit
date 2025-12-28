import { evaluate, type ProfanityEvaluation, type ProfanityEvaluateOptions } from "./engine";

export type ProfanityCheckOutcome = {
  hasProfanity: boolean;
  v1HasProfanity: boolean;
  v2Result?: ProfanityEvaluation;
};

export const runProfanityCheck = (
  text: string,
  options: {
    v1HasProfanity: boolean;
    enableV2?: boolean;
    v2Options?: ProfanityEvaluateOptions;
  },
): ProfanityCheckOutcome => {
  const v1HasProfanity = options.v1HasProfanity;
  if (!options.enableV2) {
    return { hasProfanity: v1HasProfanity, v1HasProfanity };
  }

  const v2Result = evaluate(text, options.v2Options);
  const hasProfanity = v1HasProfanity || v2Result.action !== "allow";

  return { hasProfanity, v1HasProfanity, v2Result };
};
