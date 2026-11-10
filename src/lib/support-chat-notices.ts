import { sendAdminSupportChatNoticeEmail } from "@/lib/email";
import type { createAdminClient } from "@/lib/supabase/admin";
import { buildUrl, getBaseUrl } from "@/lib/url";

type AdminClient = Pick<ReturnType<typeof createAdminClient>, "from" | "rpc">;
type Claim = { conversation_id: string; claimed_at: string; previous_notified_at: string | null };
type ConversationRow = {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  unread_admin_count: number | null;
  admin_read_at: string | null;
  visitor_left_at: string | null;
};
type MessageRow = { body: string; created_at: string | null; sender_name: string | null };

/** Latest unread visitor messages shown in one notice. */
const NOTICE_MESSAGE_LIMIT = 5;

export type SupportChatNoticeReport = { claimed: number; sent: number; released: number; failed: number };

/**
 * Mails the operations mailbox about conversations whose visitor message has
 * waited a minute unread (see claim_support_chat_admin_notices). A claim is
 * released only when the mail could not be stored in the outbox; once
 * stored, the outbox retries delivery on its own.
 */
export async function runSupportChatNotices(
  db: AdminClient,
  options: { send?: typeof sendAdminSupportChatNoticeEmail; baseUrl?: string; limit?: number } = {},
): Promise<SupportChatNoticeReport> {
  const send = options.send ?? sendAdminSupportChatNoticeEmail;
  const report: SupportChatNoticeReport = { claimed: 0, sent: 0, released: 0, failed: 0 };
  const { data, error } = await db.rpc("claim_support_chat_admin_notices", { p_limit: options.limit ?? 20 });
  if (error) throw new Error("support chat notice claim failed");
  const claims = (Array.isArray(data) ? data : []) as Claim[];
  report.claimed = claims.length;
  const baseUrl = options.baseUrl ?? getBaseUrl();

  for (const claim of claims) {
    let stored = false;
    try {
      const { data: conversation, error: conversationError } = await db
        .from("support_chat_conversations")
        .select("id, user_id, guest_name, guest_email, guest_phone, unread_admin_count, admin_read_at, visitor_left_at")
        .eq("id", claim.conversation_id)
        .maybeSingle();
      if (conversationError || !conversation) throw new Error("conversation lookup failed");
      const row = conversation as ConversationRow;
      let query = db
        .from("support_chat_messages")
        .select("body, created_at, sender_name")
        .eq("conversation_id", row.id)
        .eq("sender_type", "VISITOR");
      if (row.admin_read_at) query = query.gt("created_at", row.admin_read_at);
      const { data: messageRows, error: messageError } = await query
        .order("created_at", { ascending: false })
        .limit(NOTICE_MESSAGE_LIMIT);
      if (messageError) throw new Error("message lookup failed");
      const messages = ((messageRows ?? []) as MessageRow[]).reverse();
      if (!messages.length) throw new Error("no unread visitor message");
      const result = await send({
        conversationId: row.id,
        customerName: row.guest_name?.trim() || messages.at(-1)?.sender_name?.trim() || "방문자",
        member: Boolean(row.user_id),
        contactEmail: row.guest_email,
        contactPhone: row.guest_phone,
        messages: messages.map((message) => ({ body: message.body, createdAt: message.created_at })),
        unreadCount: Math.max(messages.length, Number(row.unread_admin_count) || 0),
        left: Boolean(row.visitor_left_at),
        link: buildUrl(`/admin/chat?conversation=${encodeURIComponent(row.id)}`, baseUrl),
        // One mail per claimed stretch, also across retried runs.
        idempotencyKey: `admin-support-chat:${row.id}:${claim.claimed_at}`,
      });
      // Stored mail is retried by the outbox. Mail switched off by
      // configuration is not retried every minute either.
      stored = result.ok || result.queued === true || result.skipped === true;
      if (result.ok || result.queued === true) report.sent += 1;
    } catch (error) {
      console.error("[support-chat-notice] notice not sent", {
        conversationId: claim.conversation_id,
        errorName: error instanceof Error ? error.message : "UnknownError",
      });
    }
    if (stored) continue;
    report.failed += 1;
    // Give the conversation back so the next run tries again.
    const released = await db.rpc("release_support_chat_admin_notice", {
      p_conversation_id: claim.conversation_id,
      p_claimed_at: claim.claimed_at,
      p_previous_notified_at: claim.previous_notified_at,
    });
    if (!released.error && released.data === true) report.released += 1;
  }
  return report;
}
