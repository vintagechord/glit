import type { createAdminClient } from "@/lib/supabase/admin";

/** The admin chat list grows by this many conversations per "더 보기". */
export const ADMIN_CHAT_PAGE_SIZE = 60;
export const ADMIN_CHAT_LIST_MAX = 600;

export const parseAdminChatListLimit = (value: string | null | undefined) => {
  const requested = Number(value);
  if (!Number.isInteger(requested) || requested < 1) return ADMIN_CHAT_PAGE_SIZE;
  return Math.min(ADMIN_CHAT_LIST_MAX, Math.ceil(requested / ADMIN_CHAT_PAGE_SIZE) * ADMIN_CHAT_PAGE_SIZE);
};

/** Newest message first; the id tiebreak keeps "load more" from repeating
 * or skipping a conversation. One extra row tells whether more exist. */
export async function loadAdminChatConversationRows<Row>(
  admin: Pick<ReturnType<typeof createAdminClient>, "from">,
  select: string,
  limit: number,
) {
  const { data, error } = await admin
    .from("support_chat_conversations")
    .select(select)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  const rows = ((data ?? []) as unknown as Row[]);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, error };
}
