import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import { CUSTOMER_EMAIL_OPERATIONS, loadSubmissionCustomerEmails } from "../src/lib/admin/submission-emails";

const sid = "70ecdcc6-2d2d-4885-a9e3-76ee99930a84";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function client(requests: URL[], status = 200) {
  return createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const body = status === 200
          ? [{ id: "m1", recipient_email: "customer@example.test", subject: "[onside] 결제 완료 및 심의 접수 안내", operation: "payment completed", status: "accepted", attempt_count: 1, created_at: "2026-11-03T10:00:00Z", accepted_at: "2026-11-03T10:00:05Z", next_attempt_at: "2026-11-03T10:00:00Z", last_attempt_at: "2026-11-03T10:00:01Z", tracking: "open+click", opened_at: "2026-11-03T10:20:00Z", last_opened_at: "2026-11-03T10:40:00Z", open_count: 2, clicked_at: "2026-11-03T10:21:00Z", last_clicked_at: "2026-11-03T10:21:00Z", click_count: 1 }]
          : { message: "fixture failure" };
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      },
    },
  });
}

test("the detail page reads only this submission's customer mail, never staff notices", async () => {
  const requests: URL[] = [];
  const result = await loadSubmissionCustomerEmails(client(requests), sid);
  assert.equal(result.error, false);
  assert.deepEqual(result.emails, [{ id: "m1", recipient: "customer@example.test", subject: "[onside] 결제 완료 및 심의 접수 안내", operation: "payment completed", status: "accepted", attempts: 1, createdAt: "2026-11-03T10:00:00Z", acceptedAt: "2026-11-03T10:00:05Z", nextAttemptAt: "2026-11-03T10:00:00Z", lastAttemptAt: "2026-11-03T10:00:01Z", tracking: "open+click", openedAt: "2026-11-03T10:20:00Z", lastOpenedAt: "2026-11-03T10:40:00Z", openCount: 2, clickedAt: "2026-11-03T10:21:00Z", lastClickedAt: "2026-11-03T10:21:00Z", clickCount: 1 }]);
  const url = requests[0];
  assert.ok(url.pathname.endsWith("/email_outbox"));
  assert.equal(url.searchParams.get("submission_id"), `eq.${sid}`);
  const operations = url.searchParams.get("operation") ?? "";
  assert.match(operations, /^in\./);
  assert.doesNotMatch(operations, /admin submission receipt/);
  for (const operation of ["payment completed", "review result", "submission update", "submission receipt"]) assert.ok(operations.includes(operation), operation);
  assert.ok(!CUSTOMER_EMAIL_OPERATIONS.includes("admin submission receipt"));
  assert.equal(url.searchParams.get("order"), "created_at.desc");
  // Never the html body of a mail.
  assert.doesNotMatch(url.searchParams.get("select") ?? "", /html/);
});

test("a failed read is reported instead of an empty history", async () => {
  const result = await loadSubmissionCustomerEmails(client([], 500), sid);
  assert.deepEqual(result, { emails: [], error: true });
});

test("the full outbox moved to the admin menu and the receipt mail now carries its submission", () => {
  const home = read("src/app/admin/page.tsx");
  assert.match(home, /href="\/admin\/emails"[\s\S]{0,400}메일 발송 내역/);
  assert.doesNotMatch(home, /이메일 발송 관리/);
  const control = read("src/components/admin/review-email-control.tsx");
  assert.doesNotMatch(control, /href="\/admin\/emails"/);
  const email = read("src/lib/email.ts");
  assert.match(email, /operation: "submission receipt", submissionId: payload\.submissionId/);
  const retry = read("src/app/admin/emails/actions.ts");
  assert.match(retry, /form\.get\("submissionId"\)/);
  assert.match(retry, /#customer-emails/);
});
