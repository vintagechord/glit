import type { SupabaseClient } from "@supabase/supabase-js";

import { mailTrackingOf } from "./customer-activity";
import { CUSTOMER_EMAIL_OPERATION_LABELS } from "./submission-emails";
import { officialArtistName } from "@/lib/submissions/artist-display";

/**
 * 메일 미확인 고객 (owner, 2026-11-25): customers who have not seen their
 * latest mail, with the contact to call them on.
 *
 * The 11/25 usage review found a member who opened none of 8 mails and never
 * visited; a supplement request sat unanswered for 13 days. Kakao notices are
 * not configured, so e-mail is the only channel and staff call instead.
 *
 * An application is listed when its newest progress mail was delivered more
 * than UNREAD_MAIL_AFTER_DAYS ago and since then nothing shows the customer saw
 * it: no open or click of any of its mails, no visit or download, and no
 * 연락 완료 by staff. Open images can be blocked, so a listed customer may have
 * read the mail; the list is a prompt to check, not proof.
 */
export const UNREAD_MAIL_AFTER_DAYS = 3;
export const UNREAD_MAIL_WINDOW_DAYS = 30;
export const UNREAD_MAIL_LIMIT = 20;
/** submission_events.event_type written by 연락 완료. */
export const CUSTOMER_CONTACTED_EVENT = "CUSTOMER_CONTACTED";

/** Mail about an application's progress. The lookup-code mail answers the
 * customer's own request and is left out. */
export const UNREAD_MAIL_OPERATIONS = ["bank payment request", "payment completed", "submission update", "review result"];

export type UnreadMailRow = {
  id: string;
  submission_id: string;
  subject: string;
  operation: string;
  recipient_email: string;
  status: string;
  accepted_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
  open_count: number | null;
  click_count: number | null;
  tracking: string | null;
};

export type UnreadSubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  artist_name_kr: string | null;
  type: string;
  status: string;
  payment_status: string | null;
  user_id: string | null;
  guest_name: string | null;
  applicant_name: string | null;
  applicant_phone: string | null;
  guest_phone: string | null;
};

export type UnreadCustomerMail = {
  submissionId: string;
  title: string | null;
  artistName: string | null;
  type: string;
  customerName: string | null;
  isGuest: boolean;
  mailLabel: string;
  mailSubject: string;
  sentAt: string;
  unreadDays: number;
  email: string;
  phone: string | null;
};

const DAY = 86_400_000;
const sentAtOf = (mail: UnreadMailRow) => mail.accepted_at ?? mail.last_attempt_at ?? mail.created_at;
const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

/** The selection itself, without the database (tests call it directly). */
export function selectUnreadCustomerMails(input: {
  mails: UnreadMailRow[];
  submissions: UnreadSubmissionRow[];
  /** Latest customer action per application: a mail open or click, a visit or a download. */
  lastCustomerActivity: Map<string, string>;
  /** Latest 연락 완료 per application. */
  lastContacted: Map<string, string>;
  profilePhones: Map<string, string>;
  now: Date;
}): UnreadCustomerMail[] {
  const latest = new Map<string, UnreadMailRow>();
  for (const mail of input.mails) {
    if (!UNREAD_MAIL_OPERATIONS.includes(mail.operation)) continue;
    const current = latest.get(mail.submission_id);
    if (!current || time(sentAtOf(mail)) > time(sentAtOf(current))) latest.set(mail.submission_id, mail);
  }
  const submissions = new Map(input.submissions.map((row) => [row.id, row]));
  const cutoff = input.now.getTime() - UNREAD_MAIL_AFTER_DAYS * DAY;
  const items: UnreadCustomerMail[] = [];
  for (const [submissionId, mail] of latest) {
    const submission = submissions.get(submissionId);
    if (!submission || submission.status === "DRAFT" || submission.payment_status === "REFUNDED") continue;
    if (mail.status !== "accepted") continue;
    const sentAt = sentAtOf(mail);
    const sent = time(sentAt);
    if (!(sent <= cutoff)) continue;
    // Mail delivered before the open image existed can never report an open.
    if (!mailTrackingOf({ tracking: mail.tracking, operation: mail.operation, acceptedAt: mail.accepted_at, lastAttemptAt: mail.last_attempt_at })) continue;
    if ((mail.open_count ?? 0) > 0 || (mail.click_count ?? 0) > 0) continue;
    if (time(input.lastCustomerActivity.get(submissionId)) >= sent) continue;
    if (time(input.lastContacted.get(submissionId)) >= sent) continue;
    items.push({
      submissionId,
      title: submission.title,
      artistName: officialArtistName(submission),
      type: submission.type,
      customerName: submission.applicant_name?.trim() || submission.guest_name?.trim() || null,
      isGuest: !submission.user_id,
      mailLabel: CUSTOMER_EMAIL_OPERATION_LABELS[mail.operation] ?? "안내 메일",
      mailSubject: mail.subject.replace(/^\[onside\]\s*/, ""),
      sentAt,
      unreadDays: Math.floor((input.now.getTime() - sent) / DAY),
      email: mail.recipient_email.trim().toLowerCase(),
      phone: submission.applicant_phone?.trim() || submission.guest_phone?.trim()
        || (submission.user_id ? input.profilePhones.get(submission.user_id) ?? null : null),
    });
  }
  // Longest waiting first.
  return items.sort((a, b) => time(a.sentAt) - time(b.sentAt)).slice(0, UNREAD_MAIL_LIMIT);
}

const latestBy = (rows: Array<{ submission_id: string; at: string }>) => {
  const map = new Map<string, string>();
  for (const row of rows) {
    const current = map.get(row.submission_id);
    if (!current || time(row.at) > time(current)) map.set(row.submission_id, row.at);
  }
  return map;
};

/** Read after authorizing an administrator. */
export async function loadUnreadCustomerMails(db: Pick<SupabaseClient, "from">, now = new Date()) {
  const since = new Date(now.getTime() - UNREAD_MAIL_WINDOW_DAYS * DAY).toISOString();
  const mails = await db.from("email_outbox")
    .select("id, submission_id, subject, operation, recipient_email, status, accepted_at, last_attempt_at, created_at, open_count, click_count, tracking")
    .not("submission_id", "is", null)
    .in("operation", UNREAD_MAIL_OPERATIONS)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (mails.error) return { items: [] as UnreadCustomerMail[], error: true };
  const mailRows = (mails.data ?? []) as UnreadMailRow[];
  const ids = [...new Set(mailRows.map((mail) => mail.submission_id))];
  if (!ids.length) return { items: [] as UnreadCustomerMail[], error: false };

  const [submissions, events, views, contacted] = await Promise.all([
    db.from("submissions")
      .select("id, title, artist_name, artist_name_kr, type, status, payment_status, user_id, guest_name, applicant_name, applicant_phone, guest_phone")
      .in("id", ids),
    db.from("submission_customer_events").select("submission_id, occurred_at")
      .in("submission_id", ids).gte("occurred_at", since)
      .in("kind", ["mail_open", "mail_click", "page_view", "download"]),
    db.from("submission_customer_views").select("submission_id, last_viewed_at, last_download_at").in("submission_id", ids),
    db.from("submission_events").select("submission_id, created_at")
      .in("submission_id", ids).eq("event_type", CUSTOMER_CONTACTED_EVENT).gte("created_at", since),
  ]);
  if (submissions.error || events.error || views.error || contacted.error) return { items: [] as UnreadCustomerMail[], error: true };

  const submissionRows = (submissions.data ?? []) as UnreadSubmissionRow[];
  const viewRows = (views.data ?? []) as Array<{ submission_id: string; last_viewed_at: string | null; last_download_at: string | null }>;
  const lastCustomerActivity = latestBy([
    ...((events.data ?? []) as Array<{ submission_id: string; occurred_at: string }>).map((row) => ({ submission_id: row.submission_id, at: row.occurred_at })),
    ...viewRows.flatMap((row) => [row.last_viewed_at, row.last_download_at].filter((at): at is string => Boolean(at))
      .map((at) => ({ submission_id: row.submission_id, at }))),
  ]);
  const lastContacted = latestBy(((contacted.data ?? []) as Array<{ submission_id: string; created_at: string }>)
    .map((row) => ({ submission_id: row.submission_id, at: row.created_at })));

  const memberIds = [...new Set(submissionRows.filter((row) => row.user_id && !row.applicant_phone && !row.guest_phone).map((row) => row.user_id as string))];
  const profilePhones = new Map<string, string>();
  if (memberIds.length) {
    const profiles = await db.from("profiles").select("user_id, phone").in("user_id", memberIds);
    for (const row of (profiles.data ?? []) as Array<{ user_id: string; phone: string | null }>) {
      if (row.phone?.trim()) profilePhones.set(row.user_id, row.phone.trim());
    }
  }
  return {
    items: selectUnreadCustomerMails({ mails: mailRows, submissions: submissionRows, lastCustomerActivity, lastContacted, profilePhones, now }),
    error: false,
  };
}
