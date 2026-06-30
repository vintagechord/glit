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
  conversation: SupportChatConversation;
  messages: SupportChatMessage[];
};

export const supportChatStorageKey = "onside:support-chat:v1";

export const supportChatAdminChannelName = "support-chat:admin";

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
