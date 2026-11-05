import type { SupabaseClient } from "@supabase/supabase-js";

/** Delivery states of the shared email outbox, as administrators read them. */
export const EMAIL_STATUS_LABELS: Record<string, string> = {
  pending: "발송 대기", sending: "발송 처리 중", retry: "자동 재시도 대기",
  accepted: "메일 서버 접수", uncertain: "접수 여부 확인 필요", failed: "발송 실패", expired: "유효 기간 종료",
};

/** Mail sent to the customer of a submission. The operations are listed
 * explicitly so staff notices (for example "admin submission receipt", which
 * also carries the submission ID) never appear as customer mail. */
export const CUSTOMER_EMAIL_OPERATION_LABELS: Record<string, string> = {
  "submission receipt": "접수 완료 안내",
  "bank payment request": "입금 안내",
  "payment completed": "결제 완료 안내",
  "submission update": "진행·상태 안내",
  "review result": "결과 안내",
  "guest lookup": "조회 코드 안내",
};
export const CUSTOMER_EMAIL_OPERATIONS = Object.keys(CUSTOMER_EMAIL_OPERATION_LABELS);

export type SubmissionCustomerEmail = {
  id: string;
  recipient: string;
  subject: string;
  operation: string;
  status: string;
  attempts: number;
  createdAt: string;
  acceptedAt: string | null;
  nextAttemptAt: string | null;
  /** Start of the attempt that delivered it (when the tracking was added). */
  lastAttemptAt: string | null;
  /** 'open', 'open+click' or null; see mailTrackingOf in customer-activity.ts. */
  tracking: string | null;
  /** First load of the open-tracking image; null when not seen (or images blocked). */
  openedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  /** First click on an Onside link in the mail. */
  clickedAt: string | null;
  lastClickedAt: string | null;
  clickCount: number;
};

export const SUBMISSION_CUSTOMER_EMAIL_LIMIT = 100;

/** The customer mail of one submission, newest first. Read only after the
 * caller has authorized an administrator. */
export async function loadSubmissionCustomerEmails(db: Pick<SupabaseClient, "from">, submissionId: string) {
  const { data, error } = await db
    .from("email_outbox")
    .select("id, recipient_email, subject, operation, status, attempt_count, created_at, accepted_at, next_attempt_at, last_attempt_at, tracking, opened_at, last_opened_at, open_count, clicked_at, last_clicked_at, click_count")
    .eq("submission_id", submissionId)
    .in("operation", CUSTOMER_EMAIL_OPERATIONS)
    .order("created_at", { ascending: false })
    .limit(SUBMISSION_CUSTOMER_EMAIL_LIMIT);
  if (error) return { emails: [] as SubmissionCustomerEmail[], error: true };
  const emails = (data ?? []).map((row) => ({
    id: String(row.id),
    recipient: String(row.recipient_email ?? ""),
    subject: String(row.subject ?? ""),
    operation: String(row.operation ?? ""),
    status: String(row.status ?? ""),
    attempts: Number(row.attempt_count ?? 0),
    createdAt: String(row.created_at),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    tracking: row.tracking ? String(row.tracking) : null,
    openedAt: row.opened_at ? String(row.opened_at) : null,
    lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
    openCount: Number(row.open_count ?? 0),
    clickedAt: row.clicked_at ? String(row.clicked_at) : null,
    lastClickedAt: row.last_clicked_at ? String(row.last_clicked_at) : null,
    clickCount: Number(row.click_count ?? 0),
  }));
  return { emails, error: false };
}
