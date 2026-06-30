import { z } from "zod";

const visitorChatMessageSchema = z.object({
  accessToken: z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.string().trim().min(20).optional(),
  ),
  body: z.string().trim().min(1).max(2000),
});

export type VisitorChatMessagePayload = z.infer<typeof visitorChatMessageSchema>;

export const parseVisitorChatMessagePayload = (payload: unknown) =>
  visitorChatMessageSchema.safeParse(payload);
