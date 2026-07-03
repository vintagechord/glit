import { z } from "zod";

const accessTokenSchema = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.string().trim().min(20).optional(),
);

const visitorChatMessageSchema = z.object({
  accessToken: accessTokenSchema,
  body: z.string().trim().min(1).max(2000),
});

const visitorChatLeaveSchema = z.object({
  accessToken: z.string().trim().min(20),
});

export type VisitorChatMessagePayload = z.infer<typeof visitorChatMessageSchema>;
export type VisitorChatLeavePayload = z.infer<typeof visitorChatLeaveSchema>;

export const parseVisitorChatMessagePayload = (payload: unknown) =>
  visitorChatMessageSchema.safeParse(payload);

export const parseVisitorChatLeavePayload = (payload: unknown) =>
  visitorChatLeaveSchema.safeParse(payload);
