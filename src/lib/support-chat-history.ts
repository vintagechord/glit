import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportChatMessage } from "./support-chat";

export type ChatHistoryCursor = { createdAt: string; id: string };
export const chatHistoryCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() });
export function parseChatHistoryCursor(params: URLSearchParams): ChatHistoryCursor | undefined {
  if (!params.has("before") && !params.has("beforeId")) return undefined;
  return chatHistoryCursorSchema.parse({ createdAt: params.get("before"), id: params.get("beforeId") });
}
export function chatHistoryQuery(cursor: ChatHistoryCursor) {
  return new URLSearchParams({ before: cursor.createdAt, beforeId: cursor.id });
}
export async function loadChatHistory(admin: SupabaseClient, conversationId: string, cursor?: ChatHistoryCursor, limit = 200) {
  let query = admin.from("support_chat_messages").select("id,conversation_id,sender_type,sender_user_id,sender_name,body,created_at").eq("conversation_id", conversationId);
  if (cursor) {
    const checked = chatHistoryCursorSchema.parse(cursor);
    query = query.or(`created_at.lt.${checked.createdAt},and(created_at.eq.${checked.createdAt},id.lt.${checked.id})`);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) throw error;
  const rows = data ?? [];
  const messages: SupportChatMessage[] = rows.slice(0, limit).reverse().map(row => ({ id: row.id, conversationId: row.conversation_id, senderType: row.sender_type, senderUserId: row.sender_user_id, senderName: row.sender_name, body: row.body, createdAt: row.created_at }));
  const first = messages[0];
  return { messages, earlierCursor: rows.length > limit && first?.createdAt ? { createdAt: first.createdAt, id: first.id } : null };
}
