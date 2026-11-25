import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CUSTOMER_CONTACTED_EVENT,
  selectUnreadCustomerMails,
  type UnreadMailRow,
  type UnreadSubmissionRow,
} from "../src/lib/admin/unread-customer-mail";

// 메일 미확인 고객 (owner, 2026-11-25): the customer's latest mail unseen for
// more than 3 days, with the contact staff call instead.

const now = new Date("2026-11-26T03:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";

const mail = (submissionId: string, days: number, overrides: Partial<UnreadMailRow> = {}): UnreadMailRow => ({
  id: `${submissionId}-${days}`, submission_id: submissionId, subject: "[onside] 심의 현황 안내 — 간이역", operation: "review result",
  recipient_email: " Artist@Naver.com ", status: "accepted", accepted_at: daysAgo(days), last_attempt_at: daysAgo(days),
  created_at: daysAgo(days), open_count: 0, click_count: 0, tracking: "open+click", ...overrides,
});
const submission = (id: string, overrides: Partial<UnreadSubmissionRow> = {}): UnreadSubmissionRow => ({
  id, title: "간이역", artist_name: "동희", artist_name_kr: null, type: "ALBUM", status: "RESULT_READY", payment_status: "PAID",
  user_id: "member-1", guest_name: null, applicant_name: "김동희", applicant_phone: "010-1234-5678", guest_phone: null, ...overrides,
});
const select = (input: Partial<Parameters<typeof selectUnreadCustomerMails>[0]> & { mails: UnreadMailRow[] }) => selectUnreadCustomerMails({
  submissions: [submission(A), submission(B, { title: "동희3집 친구야" })],
  lastCustomerActivity: new Map(), lastContacted: new Map(), profilePhones: new Map(), now, ...input,
});

test("an application whose latest mail has no open, click or visit for 3 days is listed with the contact to call", () => {
  const items = select({ mails: [mail(A, 5), mail(A, 12, { open_count: 2 })] });
  assert.equal(items.length, 1);
  assert.deepEqual(
    { ...items[0], sentAt: undefined },
    {
      submissionId: A, title: "간이역", artistName: "동희", type: "ALBUM", customerName: "김동희", isGuest: false,
      mailLabel: "결과 안내", mailSubject: "심의 현황 안내 — 간이역", sentAt: undefined, unreadDays: 5,
      email: "artist@naver.com", phone: "010-1234-5678",
    },
  );
});

test("a mail opened or clicked, or any later visit, open or download, takes the application off the list", () => {
  assert.equal(select({ mails: [mail(A, 5, { open_count: 1 })] }).length, 0);
  assert.equal(select({ mails: [mail(A, 5, { click_count: 1 })] }).length, 0);
  assert.equal(select({ mails: [mail(A, 5)], lastCustomerActivity: new Map([[A, daysAgo(4)]]) }).length, 0);
  // Activity before the latest mail does not count for it.
  assert.equal(select({ mails: [mail(A, 5)], lastCustomerActivity: new Map([[A, daysAgo(6)]]) }).length, 1);
});

test("연락 완료 clears the application until a newer mail goes unread", () => {
  assert.equal(CUSTOMER_CONTACTED_EVENT, "CUSTOMER_CONTACTED");
  assert.equal(select({ mails: [mail(A, 5)], lastContacted: new Map([[A, daysAgo(1)]]) }).length, 0);
  assert.equal(select({ mails: [mail(A, 4), mail(A, 9)], lastContacted: new Map([[A, daysAgo(6)]]) }).length, 1);
});

test("recent, untracked, undelivered, lookup-code and closed applications are not listed", () => {
  assert.equal(select({ mails: [mail(A, 2)] }).length, 0, "within 3 days");
  assert.equal(select({ mails: [mail(A, 25, { tracking: null, accepted_at: "2026-11-01T00:00:00Z", last_attempt_at: "2026-11-01T00:00:00Z" })] }).length, 0, "before the open image existed");
  assert.equal(select({ mails: [mail(A, 5, { status: "failed" })] }).length, 0, "bounces are in 메일 발송 내역");
  // The customer asked for the lookup code; the progress mail before it decides.
  assert.equal(select({ mails: [mail(A, 4, { operation: "guest lookup" }), mail(A, 5, { open_count: 1 })] }).length, 0);
  assert.equal(select({ mails: [mail(A, 5)], submissions: [submission(A, { payment_status: "REFUNDED" })] }).length, 0);
  assert.equal(select({ mails: [mail(A, 5)], submissions: [] }).length, 0, "a deleted application");
});

test("a member without an application phone shows the profile phone; the longest wait comes first", () => {
  const items = select({
    mails: [mail(A, 4), mail(B, 9, { operation: "bank payment request", subject: "[onside] 무통장 입금 계좌 및 주문 내역 안내" })],
    submissions: [submission(A, { applicant_phone: null }), submission(B, { title: "동희3집 친구야", user_id: null, guest_name: "비회원", applicant_name: null, applicant_phone: null, guest_phone: null })],
    profilePhones: new Map([["member-1", "010-9999-0000"]]),
  });
  assert.deepEqual(items.map((item) => [item.title, item.mailLabel, item.phone, item.isGuest]), [
    ["동희3집 친구야", "입금 안내", null, true],
    ["간이역", "결과 안내", "010-9999-0000", false],
  ]);
});

test("the dashboard lists them with tel/mailto links and a 연락 완료 action that records the call", () => {
  const page = readFileSync(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
  const list = readFileSync(new URL("../src/components/admin/unread-mail-list.tsx", import.meta.url), "utf8");
  const action = readFileSync(new URL("../src/app/admin/unread-mail-actions.ts", import.meta.url), "utf8");
  assert.match(page, /id="unread-mail"/);
  assert.match(page, /<UnreadMailList items=\{unread\.items\} \/>/);
  assert.match(list, /href=\{`tel:\$\{tel\}`\}/);
  assert.match(list, /href=\{`mailto:\$\{item\.email\}`\}/);
  assert.match(list, /<form action=\{markCustomerContactedAction\}/);
  assert.match(action, /await requireAdminAction\(\)/);
  assert.match(action, /event_type: CUSTOMER_CONTACTED_EVENT/);
});
