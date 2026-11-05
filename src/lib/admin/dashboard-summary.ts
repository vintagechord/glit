import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminSubmissionStageKeys,
  adminSubmissionStageOf,
  applyAdminSubmissionStageFilter,
  type AdminSubmissionStage,
} from "./submission-stages";
import { resolveSubmissionNotificationRecipient } from "./notification-recipient";
import { loadCustomerViewRecords, viewedAfterNotice } from "./customer-view-record";

export type DashboardSubmission = {
  id: string;
  title: string | null;
  artistName: string | null;
  type: string;
  stage: AdminSubmissionStage | null;
  customer: string;
  isGuest: boolean;
  amountKrw: number | null;
  updatedAt: string;
};

export type DashboardBankOrder = {
  id: string;
  submissionId: string | null;
  titles: string[];
  depositorName: string | null;
  depositDueAt: string | null;
  amountKrw: number | null;
  createdAt: string;
};

export type DashboardResultNotice = DashboardSubmission & { hasRecipient: boolean | null };

export type AdminDashboard = {
  counts: Record<AdminSubmissionStage, number | null>;
  total: number | null;
  recent: DashboardSubmission[];
  bankOrders: DashboardBankOrder[];
  resultNotices: DashboardResultNotice[];
  mailIssues: number | null;
  /** Results announced in the last 30 days that the customer has not opened since. */
  unseenResults: number | null;
  failedSections: string[];
};

const submissionColumns =
  "id, title, artist_name, type, status, payment_status, current_order_id, result_notified_at, user_id, guest_name, applicant_name, amount_krw, updated_at, created_at, is_oneclick, guest_email, guest_phone, applicant_email, applicant_phone";

type SubmissionRow = {
  id: string; title: string | null; artist_name: string | null; type: string; status: string;
  payment_status: string | null; current_order_id: string | null; result_notified_at: string | null;
  user_id: string | null; guest_name: string | null; applicant_name: string | null;
  amount_krw: number | null; updated_at: string | null; created_at: string; is_oneclick: boolean | null;
  guest_email: string | null; guest_phone: string | null; applicant_email: string | null; applicant_phone: string | null;
};

const toDashboardSubmission = (row: SubmissionRow): DashboardSubmission => ({
  id: row.id,
  title: row.title || (row.is_oneclick ? "발매된 음반 · URL 접수" : null),
  artistName: row.artist_name,
  type: row.type,
  stage: adminSubmissionStageOf(row),
  customer: row.user_id ? (row.applicant_name ? `회원 · ${row.applicant_name}` : "회원") : `비회원 · ${row.guest_name || row.applicant_name || "이름 없음"}`,
  isGuest: !row.user_id,
  amountKrw: row.amount_krw,
  updatedAt: row.updated_at ?? row.created_at,
});

const MAIL_ISSUE_DAYS = 14;

/** Kept out of the Promise.all tuple so the builder type stays shallow. */
async function loadResultPendingRows(db: SupabaseClient): Promise<{ data: SubmissionRow[] | null; error: unknown }> {
  const query = db.from("submissions").select(submissionColumns);
  const { data, error } = await applyAdminSubmissionStageFilter(query, "result_pending")
    .order("updated_at", { ascending: true }).limit(10);
  return { data: (data ?? null) as SubmissionRow[] | null, error };
}

async function countUnseenResults(db: SupabaseClient, now: Date): Promise<number | null> {
  const { data, error } = await db.from("submissions").select("id, result_notified_at")
    .not("result_notified_at", "is", null)
    .gte("result_notified_at", new Date(now.getTime() - 30 * 86_400_000).toISOString())
    .order("result_notified_at", { ascending: false }).limit(200);
  if (error) return null;
  const rows = (data ?? []) as Array<{ id: string; result_notified_at: string }>;
  const views = await loadCustomerViewRecords(db, rows.map((row) => row.id));
  if (views.error) return null;
  return rows.filter((row) => !viewedAfterNotice(views.records.get(row.id), row.result_notified_at)).length;
}

/** Everything the admin home shows; each section fails on its own. */
export async function loadAdminDashboard(db: SupabaseClient, now = new Date()): Promise<AdminDashboard> {
  const failedSections: string[] = [];
  const countQuery = (stage?: AdminSubmissionStage) => {
    const query = db.from("submissions").select("id", { count: "exact", head: true });
    return stage ? applyAdminSubmissionStageFilter(query, stage) : query.neq("status", "DRAFT");
  };

  const [stageCounts, totalResult, recentResult, ordersResult, resultRows, mailResult, unseenResults] = await Promise.all([
    Promise.all(adminSubmissionStageKeys.map(async (stage) => {
      const { count, error } = await countQuery(stage);
      return [stage, error ? null : count ?? 0] as const;
    })),
    countQuery(),
    db.from("submissions").select(submissionColumns).neq("status", "DRAFT")
      .order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(8),
    db.from("submission_orders").select("id, depositor_name, deposit_due_at, amount_krw, created_at")
      .eq("status", "BANK_PENDING").order("created_at", { ascending: true }).limit(10),
    loadResultPendingRows(db),
    db.from("email_outbox").select("id", { count: "exact", head: true })
      .in("status", ["failed", "uncertain", "expired"])
      .gte("created_at", new Date(now.getTime() - MAIL_ISSUE_DAYS * 86_400_000).toISOString()),
    countUnseenResults(db, now).catch(() => null),
  ]);

  const counts = Object.fromEntries(stageCounts) as Record<AdminSubmissionStage, number | null>;
  if (stageCounts.some(([, count]) => count === null) || totalResult.error) failedSections.push("처리 현황");
  if (recentResult.error) failedSections.push("최근 접수");
  if (ordersResult.error) failedSections.push("입금 확인 대기");
  if (resultRows.error) failedSections.push("결과 안내 대기");
  if (mailResult.error) failedSections.push("메일 발송 확인");
  if (unseenResults === null) failedSections.push("고객 결과 확인");

  let bankOrders: DashboardBankOrder[] = [];
  const orders = (ordersResult.data ?? []) as Array<{ id: string; depositor_name: string | null; deposit_due_at: string | null; amount_krw: number | null; created_at: string }>;
  if (orders.length) {
    const { data: items, error } = await db.from("submission_order_items")
      .select("order_id, submission_id, title").in("order_id", orders.map((order) => order.id));
    if (error) failedSections.push("입금 확인 대기");
    const rows = (items ?? []) as Array<{ order_id: string; submission_id: string | null; title: string | null }>;
    bankOrders = orders.map((order) => {
      const orderItems = rows.filter((item) => item.order_id === order.id);
      return {
        id: order.id,
        submissionId: orderItems.find((item) => item.submission_id)?.submission_id ?? null,
        titles: orderItems.map((item) => item.title?.trim() || "제목 미입력"),
        depositorName: order.depositor_name,
        depositDueAt: order.deposit_due_at,
        amountKrw: order.amount_krw,
        createdAt: order.created_at,
      };
    });
  }

  // A missing address blocks the result mail, so flag it before the operator
  // opens the preview. One lookup per row; the list is capped at ten.
  const resultNotices = await Promise.all(((resultRows.data ?? []) as SubmissionRow[]).map(async (row) => {
    const hasRecipient = await resolveSubmissionNotificationRecipient(db, row)
      .then(({ recipient }) => Boolean(recipient), () => null);
    return { ...toDashboardSubmission(row), hasRecipient };
  }));

  return {
    counts,
    total: totalResult.error ? null : totalResult.count ?? 0,
    recent: ((recentResult.data ?? []) as SubmissionRow[]).map(toDashboardSubmission),
    bankOrders,
    resultNotices,
    mailIssues: mailResult.error ? null : mailResult.count ?? 0,
    unseenResults,
    failedSections: [...new Set(failedSections)],
  };
}
