import { z } from "zod";

import {
  supportChatMessageMaxLength,
  supportChatMessageTooLongError,
} from "./support-chat";

const accessTokenSchema = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.string().trim().min(20).max(128).optional(),
);

const visitorChatMessageSchema = z.object({
  accessToken: accessTokenSchema,
  body: z.string().trim().min(1).max(supportChatMessageMaxLength),
});

/** What a refused message is told: the length limit when that is the reason. */
export const visitorChatMessageRefusal = (error: z.ZodError) =>
  error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === "body")
    ? supportChatMessageTooLongError
    : "메시지 내용을 확인해주세요.";

const visitorChatLeaveSchema = z.object({
  accessToken: z.string().trim().min(20).max(128),
});

export type VisitorChatMessagePayload = z.infer<typeof visitorChatMessageSchema>;
export type VisitorChatLeavePayload = z.infer<typeof visitorChatLeaveSchema>;

export const parseVisitorChatMessagePayload = (payload: unknown) =>
  visitorChatMessageSchema.safeParse(payload);

export const parseVisitorChatLeavePayload = (payload: unknown) =>
  visitorChatLeaveSchema.safeParse(payload);
