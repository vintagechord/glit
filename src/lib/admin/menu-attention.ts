import type { SupabaseClient } from "@supabase/supabase-js";

import { cashReceiptAttention, type CashReceiptStatus } from "@/lib/cash-receipts";

/**
 * The number each 관리 메뉴 card shows in its corner: what this administrator
 * has not looked at yet.
 *
 * Request pages (노래방, 매거진, 1:1 문의, 크레딧 예약) have no "read" mark of
 * their own, so the count is the pending requests that arrived after the
 * administrator last opened the page (admin_section_views). Opening the page
 * clears the badge; a request left pending stays in the page's own list.
 *
 * Chat, mail and money pages already record what was handled, so they are
 * counted from that: unread chat messages, failed mail without 확인 완료, card
 * approvals that still need a decision, and cash receipts that need an action.
 */
export const adminSeenSections = {
  karaoke: { table: "karaoke_requests", pendingStatus: "REQUESTED" },
  magazine: { table: "magazine_requests", pendingStatus: "REQUESTED" },
  inquiries: { table: "support_inquiries", pendingStatus: "NEW" },
  credit_requests: { table: "studio_reservation_requests", pendingStatus: "REQUESTED" },
} as const;

export type AdminSeenSection = keyof typeof adminSeenSections;

export const isAdminSeenSection = (value: string): value is AdminSeenSection =>
  Object.hasOwn(adminSeenSections, value);

/** Menu card href → the section counted on it. */
export const adminMenuAttentionKeys = {
  "/admin/chat": "chat",
  "/admin/inquiries": "inquiries",
  "/admin/karaoke": "karaoke",
  "/admin/magazine": "magazine",
  "/admin/credits": "credit_requests",
  "/admin/emails": "emails",
  "/admin/payments": "payments",
  "/admin/cash-receipts": "cash_receipts",
} as const;

export type AdminMenuAttentionKey = (typeof adminMenuAttentionKeys)[keyof typeof adminMenuAttentionKeys];

/** null: the count could not be loaded (no badge is shown, never a false zero). */
export type AdminMenuAttention = Record<AdminMenuAttentionKey, number | null>;

const CASH_RECEIPT_OPEN_STATUSES = ["REQUESTED", "FAILED", "ISSUING", "UNCERTAIN"];

type ReceiptRow = { status: CashReceiptStatus; updated_at: string; order: { status: string | null } | Array<{ status: string | null }> | null };

const settled = async <T>(work: () => PromiseLike<T>): Promise<T | null> => {
  try { return await work(); } catch { return null; }
};

export async function loadAdminMenuAttention(db: SupabaseClient, userId: string, now = new Date()): Promise<AdminMenuAttention> {
  const seenResult = await settled(() => db.from("admin_section_views").select("section, seen_at").eq("user_id", userId));
  const seenFailed = !seenResult || Boolean(seenResult.error);
  const seenAt = new Map(((seenResult?.data ?? []) as Array<{ section: string; seen_at: string }>).map((row) => [row.section, row.seen_at]));

  const unseenRequests = async (section: AdminSeenSection): Promise<number | null> => {
    // Without the last-opened times every old request would look new.
    if (seenFailed) return null;
    const { table, pendingStatus } = adminSeenSections[section];
    const result = await settled(() => {
      const query = db.from(table).select("id", { count: "exact", head: true }).eq("status", pendingStatus);
      const since = seenAt.get(section);
      return since ? query.gt("created_at", since) : query;
    });
    return !result || result.error ? null : result.count ?? 0;
  };

  const unreadChat = async (): Promise<number | null> => {
    const result = await settled(() => db.from("support_chat_conversations").select("unread_admin_count").gt("unread_admin_count", 0).limit(500));
    if (!result || result.error) return null;
    return ((result.data ?? []) as Array<{ unread_admin_count: number | null }>).reduce((sum, row) => sum + Math.max(0, row.unread_admin_count ?? 0), 0);
  };

  const unacknowledgedMail = async (): Promise<number | null> => {
    const result = await settled(() => db.from("email_outbox").select("id", { count: "exact", head: true })
      .in("status", ["failed", "uncertain"]).is("acknowledged_at", null));
    return !result || result.error ? null : result.count ?? 0;
  };

  const undecidedPayments = async (): Promise<number | null> => {
    const result = await settled(() => db.from("submission_payments").select("id", { count: "exact", head: true })
      .eq("status", "REQUESTED").eq("result_code", "APPROVAL_UNCERTAIN"));
    return !result || result.error ? null : result.count ?? 0;
  };

  const cashReceiptsToHandle = async (): Promise<number | null> => {
    const columns = "status, updated_at, order:submission_orders(status)";
    const [open, refunded] = await Promise.all([
      settled(() => db.from("submission_order_cash_receipts").select(columns).in("status", CASH_RECEIPT_OPEN_STATUSES).limit(200)),
      settled(() => db.from("submission_order_cash_receipts").select("status, updated_at, order:submission_orders!inner(status)")
        .eq("status", "ISSUED").neq("order.status", "PAID").limit(200)),
    ]);
    if (!open || open.error || !refunded || refunded.error) return null;
    const rows = [...((open.data ?? []) as unknown as ReceiptRow[]), ...((refunded.data ?? []) as unknown as ReceiptRow[])];
    return rows.filter((row) => {
      const order = Array.isArray(row.order) ? row.order[0] : row.order;
      return cashReceiptAttention(row, order?.status, now.getTime()) !== null;
    }).length;
  };

  const [chat, inquiries, karaoke, magazine, credit_requests, emails, payments, cash_receipts] = await Promise.all([
    unreadChat(), unseenRequests("inquiries"), unseenRequests("karaoke"), unseenRequests("magazine"),
    unseenRequests("credit_requests"), unacknowledgedMail(), undecidedPayments(), cashReceiptsToHandle(),
  ]);
  return { chat, inquiries, karaoke, magazine, credit_requests, emails, payments, cash_receipts };
}

/** Records that the administrator has the page in front of them. `renderedAt`
 * is when the list was loaded, so a request that arrived while the page was
 * loading still counts as new; a time from the future or a stale tab is
 * replaced by now. */
export async function markAdminSectionSeen(
  db: SupabaseClient,
  input: { userId: string; section: string; renderedAt?: string | null; now?: Date },
): Promise<{ ok: boolean }> {
  if (!isAdminSeenSection(input.section)) return { ok: false };
  const now = input.now ?? new Date();
  const rendered = input.renderedAt ? new Date(input.renderedAt) : null;
  const usable = rendered && Number.isFinite(rendered.getTime())
    && rendered.getTime() <= now.getTime() && now.getTime() - rendered.getTime() <= 10 * 60_000;
  const seenAt = (usable ? rendered : now).toISOString();
  const { data: current, error: readError } = await db.from("admin_section_views").select("seen_at")
    .eq("user_id", input.userId).eq("section", input.section).maybeSingle();
  if (readError) return { ok: false };
  // Never move the mark backwards (an older tab finishing late).
  if (current?.seen_at && new Date(current.seen_at).getTime() >= new Date(seenAt).getTime()) return { ok: true };
  const { error } = await db.from("admin_section_views")
    .upsert({ user_id: input.userId, section: input.section, seen_at: seenAt }, { onConflict: "user_id,section" });
  return { ok: !error };
}
