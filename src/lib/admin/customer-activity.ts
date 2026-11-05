import type { SupabaseClient } from "@supabase/supabase-js";

import { EMAIL_OPEN_TRACKING_SINCE, OPEN_TRACKED_EMAIL_OPERATIONS } from "@/lib/email-tracking-shared";
import type { CustomerViewRecord } from "./customer-view-record";
import { CUSTOMER_EMAIL_OPERATION_LABELS, type SubmissionCustomerEmail } from "./submission-emails";

/** One customer action on an application (submission_customer_events). */
export type CustomerActivityEvent = {
  id: string;
  occurredAt: string;
  kind: "page_view" | "download" | "mail_open" | "mail_click";
  /** page_view: member | guest; download: the file; mail_*: the mail operation. */
  detail: string | null;
  outboxId: string | null;
  client: string | null;
};

export const CUSTOMER_ACTIVITY_EVENT_LIMIT = 300;

/** Detailed records start with this deployment; earlier visits only exist as
 * the totals in submission_customer_views. */
export const CUSTOMER_ACTIVITY_EVENTS_SINCE = "2026-11-06";

export const ACTIVITY_CLIENT_LABELS: Record<string, string> = {
  gmail: "Gmail",
  yahoo: "Yahoo 메일",
  outlook: "Outlook",
  naver: "네이버 앱",
  kakao: "카카오톡·다음 앱",
  mail_proxy: "메일 서비스 자동 요청 · 실제 열람이 아닐 수 있음",
  apple_app: "Apple 메일·앱 내 화면",
  mobile: "모바일 브라우저",
  pc: "PC 브라우저",
  automated: "자동 요청 · 보안 검사 등",
  unknown: "환경 확인 불가",
};

export const CUSTOMER_RESULT_FILE_LABELS: Record<string, string> = {
  "mv-rating-image": "등급 이미지",
  "mv-guide": "등급 표시 사용 예시 PDF",
  "mv-certificate": "영등위 심의필증",
};
export const CUSTOMER_RESULT_FILES = Object.keys(CUSTOMER_RESULT_FILE_LABELS);

const kinds = new Set<CustomerActivityEvent["kind"]>(["page_view", "download", "mail_open", "mail_click"]);

/** The newest customer actions of one application; read after authorizing an administrator. */
export async function loadCustomerActivityEvents(db: Pick<SupabaseClient, "from">, submissionId: string) {
  const { data, error } = await db.from("submission_customer_events")
    .select("id, occurred_at, kind, detail, outbox_id, client")
    .eq("submission_id", submissionId)
    .order("occurred_at", { ascending: false })
    .limit(CUSTOMER_ACTIVITY_EVENT_LIMIT);
  if (error) return { events: [] as CustomerActivityEvent[], error: true };
  const events = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => kinds.has(row.kind as CustomerActivityEvent["kind"]))
    .map((row): CustomerActivityEvent => ({
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      kind: row.kind as CustomerActivityEvent["kind"],
      detail: row.detail ? String(row.detail) : null,
      outboxId: row.outbox_id ? String(row.outbox_id) : null,
      client: row.client ? String(row.client) : null,
    }));
  return { events, error: false };
}

const at = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

/** What a delivered mail could report: 'open+click', 'open' or null (no
 * tracking; mail delivered before the open image went live). */
export function mailTrackingOf(mail: Pick<SubmissionCustomerEmail, "tracking" | "operation" | "acceptedAt" | "lastAttemptAt">) {
  if (mail.tracking === "open" || mail.tracking === "open+click") return mail.tracking;
  const delivered = at(mail.lastAttemptAt ?? mail.acceptedAt);
  return OPEN_TRACKED_EMAIL_OPERATIONS.has(mail.operation) && delivered >= Date.parse(EMAIL_OPEN_TRACKING_SINCE) ? "open" : null;
}

export type MailReadState = "clicked" | "opened" | "unopened" | "untracked" | "not_delivered";

export function mailReadState(mail: SubmissionCustomerEmail): MailReadState {
  if (mail.clickCount > 0) return "clicked";
  if (mail.openCount > 0) return "opened";
  if (!["accepted", "uncertain"].includes(mail.status)) return "not_delivered";
  return mailTrackingOf(mail) ? "unopened" : "untracked";
}

export const MAIL_READ_STATE_LABELS: Record<MailReadState, string> = {
  clicked: "링크 클릭 확인",
  opened: "열람 확인",
  unopened: "열람 기록 없음",
  untracked: "열람 확인 불가",
  not_delivered: "발송 완료 전",
};

export const mailOperationLabel = (operation: string | null | undefined) =>
  (operation && CUSTOMER_EMAIL_OPERATION_LABELS[operation]) || "고객 안내";

/** Whether the customer took in the result after the result notice:
 * the page or a file (seen), only the result mail (mail), nothing on record
 * (none), or nothing can be known because the result mail had no tracking
 * and the page was not visited (unknown). */
export type ResultSeenState = "seen" | "mail" | "none" | "unknown";

export function resultSeenState({ notifiedAt, view, events, resultMail }: {
  notifiedAt: string | null | undefined;
  view: CustomerViewRecord | undefined;
  events: CustomerActivityEvent[];
  resultMail: SubmissionCustomerEmail | null;
}): ResultSeenState | null {
  const notice = at(notifiedAt);
  if (!Number.isFinite(notice)) return null;
  const after = (value: string | null | undefined) => at(value) >= notice;
  if (
    (view && (after(view.lastViewedAt) || after(view.lastDownloadAt))) ||
    events.some((event) => (event.kind === "page_view" || event.kind === "download") && after(event.occurredAt))
  ) return "seen";
  if (resultMail && (resultMail.openCount > 0 || resultMail.clickCount > 0)) return "mail";
  if (resultMail && mailReadState(resultMail) === "untracked") return "unknown";
  return "none";
}

/** Download count and last time per result file, from the detailed records. */
export function downloadSummary(events: CustomerActivityEvent[]) {
  const summary = new Map<string, { count: number; lastAt: string }>();
  for (const event of events) {
    if (event.kind !== "download" || !event.detail) continue;
    const entry = summary.get(event.detail);
    if (entry) entry.count += 1;
    else summary.set(event.detail, { count: 1, lastAt: event.occurredAt });
  }
  return summary;
}

export type ActivityTimelineEntry = {
  key: string;
  at: string;
  tone: "mail" | "open" | "click" | "visit" | "download";
  title: string;
  detail: string;
};

/** Mail deliveries and customer actions in one list, newest first. */
export function activityTimeline(events: CustomerActivityEvent[], emails: SubmissionCustomerEmail[]): ActivityTimelineEntry[] {
  const mailById = new Map(emails.map((mail) => [mail.id, mail]));
  const client = (value: string | null) => ACTIVITY_CLIENT_LABELS[value ?? "unknown"] ?? ACTIVITY_CLIENT_LABELS.unknown;
  const entries: ActivityTimelineEntry[] = events.map((event) => {
    const mail = event.outboxId ? mailById.get(event.outboxId) : undefined;
    const mailName = `${mailOperationLabel(event.detail ?? mail?.operation)} 메일`;
    switch (event.kind) {
      case "mail_open":
        return { key: event.id, at: event.occurredAt, tone: "open", title: `${mailName} 열람`, detail: client(event.client) };
      case "mail_click":
        return { key: event.id, at: event.occurredAt, tone: "click", title: `${mailName} 링크 클릭`, detail: client(event.client) };
      case "download":
        return {
          key: event.id, at: event.occurredAt, tone: "download",
          title: `결과 파일 다운로드 · ${CUSTOMER_RESULT_FILE_LABELS[event.detail ?? ""] ?? "결과 파일"}`,
          detail: client(event.client),
        };
      default:
        return {
          key: event.id, at: event.occurredAt, tone: "visit",
          title: "결과 페이지 방문",
          detail: [event.detail === "guest" ? "비회원 조회 링크" : event.detail === "member" ? "회원 로그인" : null, client(event.client)].filter(Boolean).join(" · "),
        };
    }
  });
  for (const mail of emails) {
    if (!mail.acceptedAt) continue;
    entries.push({
      key: `mail-${mail.id}`, at: mail.acceptedAt, tone: "mail",
      title: `${mailOperationLabel(mail.operation)} 메일 발송 · 메일 서버 접수`,
      detail: mailTrackingOf(mail) ? "열람 확인 가능" : "열람 확인 기능 도입 전 발송 · 열람 여부 확인 불가",
    });
  }
  return entries.sort((a, b) => at(b.at) - at(a.at));
}
