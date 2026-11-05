import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyActivityClient, emailOpenToken, isValidEmailOpenToken, safeTrackedTarget, withCustomerEmailTracking, withEmailOpenPixel,
} from "../src/lib/customer-result-tracking";
import {
  activityTimeline, downloadSummary, mailReadState, mailTrackingOf, resultSeenState, type CustomerActivityEvent,
} from "../src/lib/admin/customer-activity";
import type { SubmissionCustomerEmail } from "../src/lib/admin/submission-emails";
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

test("only the customer's own visits and downloads are recorded, with the file and the client kind", () => {
  const track = read("src/app/track/[token]/page.tsx");
  assert.match(track, /isAdmin === true \? "admin" : "member"/);
  assert.match(track, /if \(viewer !== "admin" && viewer !== "unknown"\) \{[\s\S]{0,200}recordCustomerResultViewAfterResponse\(detail\.submission\.id, \{ via: "guest", client: classifyActivityClient\(userAgent\) \}\)/);
  const member = read("src/app/dashboard/submissions/[id]/view.tsx");
  assert.match(member, /hasGuestPaymentResultGrant \|\|\s*\(user\?\.id && \(memberResult\.submission[^)]*\)\?\.user_id === user\.id\)/);
  assert.match(member, /via: hasGuestPaymentResultGrant \? "guest" : "member"/);
  for (const name of ["mv-certificate", "mv-guide", "mv-rating-image"]) {
    assert.match(
      read(`src/app/api/submissions/[id]/${name}/route.ts`),
      new RegExp(`if \\(!viaAdmin\\) recordCustomerResultViewAfterResponse\\(submissionId, \\{ download: "${name}", client: classifyActivityClient\\(req\\.headers\\.get\\("user-agent"\\)\\) \\}\\)`),
    );
  }
  const preview = read("src/app/admin/submissions/customer-view/page.tsx");
  assert.doesNotMatch(preview, /recordCustomerResultView/);
});

test("the open image and click endpoints answer every request and record only signed ones", () => {
  const route = read("src/app/api/email/open/[id]/[file]/route.ts");
  assert.match(route, /if \(isValidEmailOpenToken\(id, token\)\) \{\s*recordEmailActivityAfterResponse\(id\.toLowerCase\(\), "mail_open"/);
  assert.match(route, /"Content-Type": "image\/gif"/);
  assert.match(route, /no-store/);
  const click = read("src/app/api/email/click/[id]/[token]/route.ts");
  assert.match(click, /const target = safeTrackedTarget\(/);
  assert.match(click, /if \(isValidEmailOpenToken\(id, token\.toLowerCase\(\)\)\) \{\s*recordEmailActivityAfterResponse\(id\.toLowerCase\(\), "mail_click"/);
  assert.match(click, /status: 302/);
  assert.match(click, /"Referrer-Policy": "no-referrer"/);
  // Mail links must not be held up by the session checks of the proxy.
  assert.match(read("src/proxy.ts"), /\/\^\\\/api\\\/email\\\/click\\\/\/\.test\(pathname\)\) \{\s*return NextResponse\.next\(\);/);
  const migration = read("supabase/migrations/20261105150000_customer_view_and_email_open_tracking.sql");
  assert.match(migration, /and o\.status = 'accepted'/);
  assert.match(migration, /revoke all on public\.submission_customer_views from public, anon, authenticated;/);
  const events = read("supabase/migrations/20261106120000_customer_activity_events.sql");
  assert.match(events, /revoke all on public\.submission_customer_events from public, anon, authenticated;/);
  assert.match(events, /grant execute on function public\.record_customer_activity\(uuid, text, text, text\) to service_role;/);
  assert.match(events, /grant execute on function public\.record_email_activity\(uuid, text, text\) to service_role;/);
  assert.doesNotMatch(events, /drop function/i, "the running deployment keeps its functions");
});

test("Onside links in customer mail go through the signed click redirect", () => {
  const html = `<html><body><a href="https://iamonside.com/track/abc?x=1&amp;y=2#r" style="x">결과</a> <a href="https://example.com/out">밖</a> <a href="mailto:a@b.c">메일</a></body></html>`;
  const mail = { id: outboxId.toUpperCase(), operation: "review result", submission_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", html };
  const { html: tracked, tracking } = withCustomerEmailTracking(mail, { baseUrl: "https://iamonside.com", key });
  const token = emailOpenToken(outboxId, key);
  assert.equal(tracking, "open+click");
  assert.ok(tracked.includes(`<a href="https://iamonside.com/api/email/click/${outboxId}/${token}?to=${encodeURIComponent("/track/abc?x=1&y=2#r")}" style="x">`));
  assert.ok(tracked.includes('<a href="https://example.com/out">'), "other sites are left alone");
  assert.ok(tracked.includes('<a href="mailto:a@b.c">'));
  assert.ok(tracked.includes(`/api/email/open/${outboxId}/${token}.gif`));
  const noLinks = withCustomerEmailTracking({ ...mail, html: "<p>x</p>" }, { baseUrl: "https://iamonside.com", key });
  assert.equal(noLinks.tracking, "open");
  assert.deepEqual(withCustomerEmailTracking({ ...mail, operation: "password reset" }, { baseUrl: "https://iamonside.com", key }), { html, tracking: null });
});

test("a tracked link only ever opens a page of the Onside site", () => {
  const base = "https://iamonside.com";
  assert.equal(safeTrackedTarget("/dashboard/submissions/x?view=1#a", base), "https://iamonside.com/dashboard/submissions/x?view=1#a");
  for (const bad of [null, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "/\u0000x"]) {
    assert.equal(safeTrackedTarget(bad, base), "https://iamonside.com/", String(bad));
  }
});

test("requests are sorted into coarse client kinds, never stored raw", () => {
  const cases: Array<[string | null, string]> = [
    ["Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)", "gmail"],
    ["Mozilla/5.0", "mail_proxy"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", "apple_app"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.0.0)", "naver"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.0", "kakao"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36", "mobile"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36", "pc"],
    ["Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.1)", "outlook"],
    ["curl/8.7.1", "automated"],
    [null, "unknown"],
  ];
  for (const [ua, expected] of cases) assert.equal(classifyActivityClient(ua), expected, String(ua));
});

test("delivery notes the tracking it added before sending, and a failed note never blocks the mail", async () => {
  const row = {
    id: outboxId, idempotency_key: "b".repeat(64), provider: "smtp", recipient_email: "c@example.com", subject: "s",
    html: "<p>stored</p>", reply_to: null, operation: "review result", status: "pending", attempt_count: 0, max_attempts: 5,
    lease_token: "lease", lease_expires_at: null, next_attempt_at: new Date().toISOString(), provider_message_id: null,
    last_error_reason: null, last_error_code: null, expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), submission_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  } as EmailOutboxRow;
  const steps: string[] = [];
  const store = (mark: (id: string, tracking: string) => Promise<void>) => ({
    enqueue: async () => row, claim: async () => [row], get: async () => row,
    finish: async () => ({ ...row, status: "accepted" as const }), stats: async () => ({}) as never, markTracking: mark,
  });
  const deliver = async (message: { html: string }) => { steps.push(`deliver:${message.html}`); return { ok: true, outcome: "accepted" as const }; };
  const decorateHtml = (mail: { html: string }) => ({ html: `${mail.html}<img>`, tracking: "open+click" });
  await createEmailOutboxService({ store: store(async (id, tracking) => { steps.push(`mark:${id}:${tracking}`); }), deliver, decorateHtml })
    .enqueueAndSend({ to: "c@example.com", subject: "s", html: "<p>stored</p>", operation: "review result", submissionId: row.submission_id ?? undefined }, "smtp");
  assert.deepEqual(steps, [`mark:${outboxId}:open+click`, "deliver:<p>stored</p><img>"]);
  steps.length = 0;
  await createEmailOutboxService({ store: store(async () => { throw new Error("db down"); }), deliver, decorateHtml })
    .enqueueAndSend({ to: "c@example.com", subject: "s", html: "<p>stored</p>", operation: "review result", submissionId: row.submission_id ?? undefined }, "smtp");
  assert.deepEqual(steps, ["deliver:<p>stored</p><img>"]);
});

const mail = (overrides: Partial<SubmissionCustomerEmail> = {}): SubmissionCustomerEmail => ({
  id: "m1", recipient: "c@example.test", subject: "s", operation: "review result", status: "accepted", attempts: 1,
  createdAt: "2026-11-06T01:00:00Z", acceptedAt: "2026-11-06T01:00:05Z", nextAttemptAt: null, lastAttemptAt: "2026-11-06T01:00:01Z",
  tracking: "open+click", openedAt: null, lastOpenedAt: null, openCount: 0, clickedAt: null, lastClickedAt: null, clickCount: 0,
  ...overrides,
});

test("mail delivered before the open image is told apart from mail that was not opened", () => {
  // The HUG result mail: accepted at 19:45 KST, the image went live at 20:02 KST.
  const hug = mail({ tracking: null, createdAt: "2026-11-05T10:45:00Z", acceptedAt: "2026-11-05T10:45:06Z", lastAttemptAt: "2026-11-05T10:45:01Z" });
  assert.equal(mailTrackingOf(hug), null);
  assert.equal(mailReadState(hug), "untracked");
  // Created before, delivered after: it carried the image.
  const late = mail({ tracking: null, createdAt: "2026-11-05T10:57:01Z", acceptedAt: "2026-11-05T17:05:05Z", lastAttemptAt: "2026-11-05T17:05:01Z" });
  assert.equal(mailTrackingOf(late), "open");
  assert.equal(mailReadState(late), "unopened");
  assert.equal(mailReadState(mail()), "unopened");
  assert.equal(mailReadState(mail({ openCount: 1, openedAt: "2026-11-06T02:00:00Z" })), "opened");
  assert.equal(mailReadState(mail({ openCount: 1, clickCount: 1 })), "clicked");
  assert.equal(mailReadState(mail({ status: "failed" })), "not_delivered");
  assert.equal(mailReadState(hug), "untracked", "an untracked mail is never reported as unopened");
});

test("the result counts as seen from the page or a file after the notice, and the mail is reported apart", () => {
  const notifiedAt = "2026-11-06T01:00:06Z";
  const event = (kind: CustomerActivityEvent["kind"], occurredAt: string, detail: string | null = null): CustomerActivityEvent =>
    ({ id: `${kind}-${occurredAt}`, occurredAt, kind, detail, outboxId: null, client: "pc" });
  assert.equal(resultSeenState({ notifiedAt: null, view: undefined, events: [], resultMail: null }), null);
  assert.equal(resultSeenState({ notifiedAt, view: undefined, events: [], resultMail: mail() }), "none");
  assert.equal(resultSeenState({ notifiedAt, view: undefined, events: [], resultMail: mail({ tracking: null, lastAttemptAt: "2026-11-05T10:45:01Z" }) }), "unknown");
  assert.equal(resultSeenState({ notifiedAt, view: undefined, events: [], resultMail: mail({ openCount: 1 }) }), "mail");
  assert.equal(resultSeenState({ notifiedAt, view: undefined, events: [event("download", "2026-11-06T02:00:00Z", "mv-certificate")], resultMail: mail() }), "seen");
  assert.equal(resultSeenState({ notifiedAt, view: undefined, events: [event("page_view", "2026-11-05T02:00:00Z", "member")], resultMail: mail() }), "none", "a visit before the notice does not count");
  const view = { firstViewedAt: "2026-11-05T12:00:00Z", lastViewedAt: "2026-11-06T03:00:00Z", viewCount: 2, lastDownloadAt: null, downloadCount: 0 };
  assert.equal(resultSeenState({ notifiedAt, view, events: [], resultMail: null }), "seen");

  const events = [
    event("download", "2026-11-06T02:10:00Z", "mv-certificate"),
    event("download", "2026-11-06T02:05:00Z", "mv-certificate"),
    event("download", "2026-11-06T02:04:00Z", "mv-guide"),
    event("page_view", "2026-11-06T02:03:00Z", "member"),
    { ...event("mail_click", "2026-11-06T02:02:00Z", "review result"), outboxId: "m1", client: "naver" },
    { ...event("mail_open", "2026-11-06T02:01:00Z", "review result"), outboxId: "m1", client: "pc" },
  ];
  const downloads = downloadSummary(events);
  assert.deepEqual(downloads.get("mv-certificate"), { count: 2, lastAt: "2026-11-06T02:10:00Z" });
  assert.deepEqual(downloads.get("mv-guide"), { count: 1, lastAt: "2026-11-06T02:04:00Z" });
  assert.equal(downloads.has("mv-rating-image"), false);
  const timeline = activityTimeline(events, [mail()]);
  assert.deepEqual(timeline.map((entry) => entry.tone), ["download", "download", "download", "visit", "click", "open", "mail"]);
  assert.equal(timeline[3].title, "결과 페이지 방문");
  assert.equal(timeline[3].detail, "회원 로그인 · PC 브라우저");
  assert.equal(timeline[4].title, "결과 안내 메일 링크 클릭");
  assert.equal(timeline[4].detail, "네이버 앱");
  assert.equal(timeline[0].title, "결과 파일 다운로드 · 영등위 심의필증");
});
