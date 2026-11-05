import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emailOpenToken, isValidEmailOpenToken, withEmailOpenPixel } from "../src/lib/customer-result-tracking";
import { viewedAfterNotice } from "../src/lib/admin/customer-view-record";
import { createEmailOutboxService, type EmailOutboxRow } from "../src/lib/email-outbox";

const key = createHmac("sha256", "test-secret").update("fixture").digest();
const outboxId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("open-tracking links are signed per mail and refuse forged tokens", () => {
  const token = emailOpenToken(outboxId, key);
  assert.match(token ?? "", /^[0-9a-f]{32}$/);
  assert.equal(isValidEmailOpenToken(outboxId, token!, key), true);
  assert.equal(isValidEmailOpenToken("ffffffff-ffff-4fff-8fff-ffffffffffff", token!, key), false);
  assert.equal(isValidEmailOpenToken(outboxId, "0".repeat(32), key), false);
  assert.equal(isValidEmailOpenToken(outboxId, "not-a-token", key), false);
  assert.equal(emailOpenToken(outboxId, null), null);
});

test("only customer mail about an application carries the open image", () => {
  const base = { id: outboxId, submission_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", html: "<html><body><p>결과</p></body></html>" };
  const tracked = withEmailOpenPixel({ ...base, operation: "review result" }, { baseUrl: "https://iamonside.com/", key });
  assert.match(tracked, new RegExp(`<img src="https://iamonside.com/api/email/open/${outboxId}/${emailOpenToken(outboxId, key)}\\.gif" width="1" height="1" alt=""`));
  assert.ok(tracked.indexOf("<img") < tracked.indexOf("</body>"));
  for (const operation of ["signup verification", "password reset", "admin submission receipt"]) {
    assert.equal(withEmailOpenPixel({ ...base, operation }, { baseUrl: "https://iamonside.com", key }), base.html);
  }
  assert.equal(withEmailOpenPixel({ ...base, submission_id: null, operation: "review result" }, { key }), base.html);
  assert.equal(withEmailOpenPixel({ ...base, operation: "review result" }, { baseUrl: "https://iamonside.com", key: null }), base.html);
});

test("the image is added at delivery only; the stored body is unchanged", async () => {
  const row = {
    id: outboxId, idempotency_key: "a".repeat(64), provider: "smtp", recipient_email: "c@example.com", subject: "s",
    html: "<p>stored</p>", reply_to: null, operation: "review result", status: "pending", attempt_count: 0, max_attempts: 5,
    lease_token: "lease", lease_expires_at: null, next_attempt_at: new Date().toISOString(), provider_message_id: null,
    last_error_reason: null, last_error_code: null, expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), submission_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  } as EmailOutboxRow;
  const delivered: string[] = [];
  const service = createEmailOutboxService({
    store: {
      enqueue: async () => row, claim: async () => [row], get: async () => row,
      finish: async () => ({ ...row, status: "accepted" }), stats: async () => ({}) as never,
    },
    deliver: async (message) => { delivered.push(message.html); return { ok: true, outcome: "accepted" }; },
    decorateHtml: (mail) => `${mail.html}<img data-open>`,
  });
  await service.enqueueAndSend({ to: "c@example.com", subject: "s", html: "<p>stored</p>", operation: "review result", submissionId: row.submission_id ?? undefined }, "smtp");
  assert.deepEqual(delivered, ["<p>stored</p><img data-open>"]);
  assert.equal(row.html, "<p>stored</p>");

  const failingDecoration = createEmailOutboxService({
    store: { enqueue: async () => row, claim: async () => [row], get: async () => row, finish: async () => ({ ...row, status: "accepted" }), stats: async () => ({}) as never },
    deliver: async (message) => { delivered.push(message.html); return { ok: true, outcome: "accepted" }; },
    decorateHtml: () => { throw new Error("no key"); },
  });
  await failingDecoration.enqueueAndSend({ to: "c@example.com", subject: "s", html: "<p>stored</p>", operation: "review result" }, "smtp");
  assert.equal(delivered.at(-1), "<p>stored</p>", "a tracking failure never blocks the mail");
});

test("a result counts as seen only when the customer came back after the notice", () => {
  const record = { firstViewedAt: "2026-11-05T10:00:00Z", lastViewedAt: "2026-11-05T10:30:00Z", viewCount: 2, lastDownloadAt: null, downloadCount: 0 };
  assert.equal(viewedAfterNotice(record, "2026-11-05T10:45:00Z"), false);
  assert.equal(viewedAfterNotice({ ...record, lastViewedAt: "2026-11-05T11:00:00Z" }, "2026-11-05T10:45:00Z"), true);
  assert.equal(viewedAfterNotice({ ...record, lastDownloadAt: "2026-11-05T11:00:00Z", downloadCount: 1 }, "2026-11-05T10:45:00Z"), true);
  assert.equal(viewedAfterNotice(undefined, "2026-11-05T10:45:00Z"), false);
  assert.equal(viewedAfterNotice(record, null), false);
});

test("only the customer's own visits and downloads are recorded", () => {
  const track = read("src/app/track/[token]/page.tsx");
  assert.match(track, /isAdmin === true \? "admin" : "member"/);
  assert.match(track, /if \(viewer !== "admin" && viewer !== "unknown"\) recordCustomerResultViewAfterResponse\(detail\.submission\.id\)/);
  const member = read("src/app/dashboard/submissions/[id]/view.tsx");
  assert.match(member, /hasGuestPaymentResultGrant \|\|\s*\(user\?\.id && \(memberResult\.submission[^)]*\)\?\.user_id === user\.id\)/);
  for (const name of ["mv-certificate", "mv-guide", "mv-rating-image"]) {
    assert.match(read(`src/app/api/submissions/[id]/${name}/route.ts`), /if \(!viaAdmin\) recordCustomerResultViewAfterResponse\(submissionId, \{ download: true \}\)/);
  }
  const preview = read("src/app/admin/submissions/customer-view/page.tsx");
  assert.doesNotMatch(preview, /recordCustomerResultView/);
});

test("the open image endpoint always answers with an image and records only signed requests", () => {
  const route = read("src/app/api/email/open/[id]/[file]/route.ts");
  assert.match(route, /if \(isValidEmailOpenToken\(id, token\)\) recordEmailOpenAfterResponse/);
  assert.match(route, /"Content-Type": "image\/gif"/);
  assert.match(route, /no-store/);
  const migration = read("supabase/migrations/20261105150000_customer_view_and_email_open_tracking.sql");
  assert.match(migration, /and o\.status = 'accepted'/);
  assert.match(migration, /revoke all on public\.submission_customer_views from public, anon, authenticated;/);
});
