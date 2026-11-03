export type SupportChatStatus =
  | "OPEN"
  | "WAITING_ADMIN"
  | "WAITING_VISITOR"
  | "CLOSED";

export type SupportChatSenderType = "VISITOR" | "ADMIN" | "SYSTEM";

export type SupportChatConversation = {
  id: string;
  accessToken: string;
  userId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  status: SupportChatStatus;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadAdminCount: number;
  unreadVisitorCount: number;
  visitorLeftAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SupportChatMessage = {
  id: string;
  conversationId: string;
  senderType: SupportChatSenderType;
  senderUserId: string | null;
  senderName: string | null;
  body: string;
  createdAt: string | null;
};

export type SupportChatPayload = {
  earlierCursor?: { createdAt: string; id: string } | null;
  conversation: SupportChatConversation;
  messages: SupportChatMessage[];
};

export type SupportChatBroadcastPayload = {
  conversation?: SupportChatConversation;
  message?: SupportChatMessage;
  deletedId?: string;
};

export const supportChatStorageKey = "onside:support-chat:v1";

export const supportChatConversationTokensStorageKey =
  "onside:support-chat:tokens:v1";

// Renamed from "support-chat:admin", which carried full conversations and
// access tokens: browsers still running the old bundle keep sending those
// there, so current clients must not listen on that topic.
export const supportChatAdminChannelName = "support-chat:signals";

// The admin channel is a public Realtime topic: anyone holding the anon key can
// join it, and every open visitor widget does. It therefore carries only a
// conversation id. Receivers refetch through the API, which checks the admin
// role or the visitor's token. Never put a conversation, message, access token
// or contact detail on it.
export type SupportChatAdminSignal = { conversationId: string };

export const toSupportChatAdminSignal = (
  payload: SupportChatBroadcastPayload,
): SupportChatAdminSignal | null => {
  const conversationId =
    payload.deletedId ??
    payload.conversation?.id ??
    payload.message?.conversationId ??
    null;
  return conversationId ? { conversationId } : null;
};

export const readSupportChatAdminSignal = (
  payload: unknown,
): SupportChatAdminSignal | null => {
  if (!payload || typeof payload !== "object") return null;
  const conversationId = (payload as { conversationId?: unknown })
    .conversationId;
  return typeof conversationId === "string" &&
    /^[0-9a-f-]{36}$/i.test(conversationId)
    ? { conversationId }
    : null;
};

export const supportChatChannelName = (
  conversationId: string,
  accessToken: string,
) => `support-chat:${conversationId}:${accessToken}`;

export const supportChatStatusLabels: Record<SupportChatStatus, string> = {
  OPEN: "상담 진행",
  WAITING_ADMIN: "관리자 답변 대기",
  WAITING_VISITOR: "사용자 답변 대기",
  CLOSED: "상담 종료",
};
