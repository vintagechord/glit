import { z } from "zod";

const submissionDeleteSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export const parseSubmissionDeletePayload = (value: unknown) => {
  const parsed = submissionDeleteSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ids: Array.from(new Set(parsed.data.ids)),
  };
};
