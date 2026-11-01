// Client-safe half of the chat history helpers: no zod, no Supabase.
export type ChatHistoryCursor = { createdAt: string; id: string };

export function chatHistoryQuery(cursor: ChatHistoryCursor) {
  return new URLSearchParams({ before: cursor.createdAt, beforeId: cursor.id });
}
