import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REVIEW_ADMIN_EMAIL, sendAdminSupportChatNoticeEmail } from "../src/lib/email";
import { setEmailOutboxTestDispatcher, type EmailMessage } from "../src/lib/email-transport";
import { runSupportChatNotices } from "../src/lib/support-chat-notices";

const read = (path: string) => readFileSync(path, "utf8");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function withCapturedMail(run: (sent: EmailMessage[]) => Promise<void>) {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM, env: process.env.NODE_ENV };
  process.env.RESEND_API_KEY = "fixture-api-key";
  process.env.RESEND_FROM = "onside <noreply@example.invalid>";
  Object.assign(process.env, { NODE_ENV: "test" });
  const sent: EmailMessage[] = [];
  setEmailOutboxTestDispatcher(async (message) => { sent.push(message); return { ok: true, queued: true }; });
  try { await run(sent); } finally {
    setEmailOutboxTestDispatcher(undefined);
    for (const [name, value] of [["RESEND_API_KEY", saved.key], ["RESEND_FROM", saved.from], ["NODE_ENV", saved.env]] as const) {
      if (value === undefined) delete (process.env as Record<string, string | undefined>)[name];
      else Object.assign(process.env, { [name]: value });
    }
  }
}

test("the chat notice goes to the operations mailbox with the unread messages and a link to the conversation", async () => {
  await withCapturedMail(async (sent) => {
    const result = await sendAdminSupportChatNoticeEmail({
      conversationId: A, customerName: "홍길동<script>", member: false, contactEmail: "guest@example.invalid", contactPhone: null,
      messages: [{ body: "심의 기간이 궁금합니다\n<b>급해요</b>", createdAt: "2026-11-10T01:00:00Z" }], unreadCount: 2, left: false,
      link: `https://iamonside.com/admin/chat?conversation=${A}`, idempotencyKey: `admin-support-chat:${A}:2026-11-10T01:01:00Z`,
    });
    assert.equal(result.ok, true);
    const [mail] = sent;
    assert.equal(mail.to, REVIEW_ADMIN_EMAIL);
    assert.equal(REVIEW_ADMIN_EMAIL, "iamonside@daum.net");
    assert.equal(mail.operation, "admin support chat notice");
    assert.match(mail.subject, /^\[onside 관리자\] 새 채팅 문의 · 홍길동<script>$/);
    assert.match(mail.html, /홍길동&lt;script&gt; \(비회원\)/);
    assert.match(mail.html, /&lt;b&gt;급해요&lt;\/b&gt;/);
    assert.doesNotMatch(mail.html, /<script>|<b>급해요/);
    assert.match(mail.html, /guest@example\.invalid/);
    assert.match(mail.html, new RegExp(`/admin/chat\\?conversation=${A}`));
    assert.equal(mail.idempotencyKey, `admin-support-chat:${A}:2026-11-10T01:01:00Z`);
  });
  assert.equal((await sendAdminSupportChatNoticeEmail({ conversationId: A, customerName: "x", member: true, messages: [], unreadCount: 0, left: false, link: "https://iamonside.com/admin/chat" })).ok, false);
});

type Call = { name: string; args?: unknown };
function fakeDb(conversations: Record<string, unknown>, messages: Record<string, unknown[]>, claims: unknown[]) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      async rpc(name: string, args: unknown) {
        calls.push({ name, args });
        if (name === "claim_support_chat_admin_notices") return { data: claims, error: null };
        return { data: true, error: null };
      },
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const query = {
          select() { return query; },
          eq(column: string, value: unknown) { filters[column] = value; return query; },
          gt(column: string, value: unknown) { filters[`${column}>`] = value; return query; },
          order() { return query; },
          async limit() { calls.push({ name: `messages:${filters.conversation_id}`, args: filters }); return { data: messages[String(filters.conversation_id)] ?? [], error: null }; },
          async maybeSingle() { return { data: table === "support_chat_conversations" ? conversations[String(filters.id)] ?? null : null, error: null }; },
        };
        return query;
      },
    } as never,
  };
}

test("each claimed conversation is mailed once, and a claim whose mail was not stored is released", async () => {
  const claims = [
    { conversation_id: A, claimed_at: "2026-11-10T01:02:00Z", previous_notified_at: null },
    { conversation_id: B, claimed_at: "2026-11-10T01:02:00Z", previous_notified_at: "2026-11-09T00:00:00Z" },
    { conversation_id: C, claimed_at: "2026-11-10T01:02:00Z", previous_notified_at: null },
  ];
  const conversations = {
    [A]: { id: A, user_id: null, guest_name: null, guest_email: null, guest_phone: "010-0000-0000", unread_admin_count: 3, admin_read_at: "2026-11-10T00:30:00Z", visitor_left_at: null },
    [B]: { id: B, user_id: "member", guest_name: "회원 고객", guest_email: "m@example.invalid", guest_phone: null, unread_admin_count: 1, admin_read_at: null, visitor_left_at: "2026-11-10T01:01:30Z" },
    // C was read between the claim and the lookup: nothing unread to report.
    [C]: { id: C, user_id: null, guest_name: "읽음", guest_email: null, guest_phone: null, unread_admin_count: 0, admin_read_at: "2026-11-10T01:01:59Z", visitor_left_at: null },
  };
  const messages = {
    [A]: [{ body: "두 번째", created_at: "2026-11-10T01:00:30Z", sender_name: "방문자 A" }, { body: "첫 번째", created_at: "2026-11-10T01:00:00Z", sender_name: "방문자 A" }],
    [B]: [{ body: "회원 문의", created_at: "2026-11-10T01:00:00Z", sender_name: "회원 고객" }],
  };
  const { db, calls } = fakeDb(conversations, messages, claims);
  const sent: Array<Parameters<typeof sendAdminSupportChatNoticeEmail>[0]> = [];
  const report = await runSupportChatNotices(db, {
    baseUrl: "https://iamonside.com",
    send: async (payload) => { sent.push(payload); return payload.conversationId === B ? { ok: false, queued: false, reason: "configuration" } : { ok: true, queued: true }; },
  });
  assert.deepEqual(report, { claimed: 3, sent: 1, released: 2, failed: 2 });
  const [first, second] = sent;
  assert.equal(first.customerName, "방문자 A");
  assert.equal(first.member, false);
  assert.deepEqual(first.messages.map((message) => message.body), ["첫 번째", "두 번째"], "oldest first");
  assert.equal(first.unreadCount, 3);
  assert.equal(first.link, `https://iamonside.com/admin/chat?conversation=${A}`);
  assert.equal(first.idempotencyKey, `admin-support-chat:${A}:2026-11-10T01:02:00Z`);
  // Only messages after the administrator last read the conversation.
  assert.deepEqual((calls.find((call) => call.name === `messages:${A}`)?.args as Record<string, unknown>)["created_at>"], "2026-11-10T00:30:00Z");
  assert.equal(second.member, true); assert.equal(second.left, true);
  const releases = calls.filter((call) => call.name === "release_support_chat_admin_notice").map((call) => call.args);
  assert.deepEqual(releases, [
    { p_conversation_id: B, p_claimed_at: "2026-11-10T01:02:00Z", p_previous_notified_at: "2026-11-09T00:00:00Z" },
    { p_conversation_id: C, p_claimed_at: "2026-11-10T01:02:00Z", p_previous_notified_at: null },
  ]);
});

test("mail switched off by configuration is not retried every minute", async () => {
  const claims = [{ conversation_id: A, claimed_at: "2026-11-10T01:02:00Z", previous_notified_at: null }];
  const { db, calls } = fakeDb({ [A]: { id: A, user_id: null, guest_name: "고객", unread_admin_count: 1, admin_read_at: null, visitor_left_at: null } },
    { [A]: [{ body: "문의", created_at: "2026-11-10T01:00:00Z", sender_name: "고객" }] }, claims);
  const report = await runSupportChatNotices(db, { baseUrl: "https://iamonside.com", send: async () => ({ ok: false, skipped: true, reason: "configuration" }) });
  assert.deepEqual(report, { claimed: 1, sent: 0, released: 0, failed: 0 });
  assert.ok(!calls.some((call) => call.name === "release_support_chat_admin_notice"));
});

test("reads and answers stamp admin_read_at, the scheduler runs the notice task, and the SQL waits a minute", () => {
  const adminRoute = read("src/app/api/admin/chat/route.ts");
  assert.match(adminRoute, /unread_admin_count: 0,\s*\/\/[^\n]*\n\s*admin_read_at: new Date\(\)\.toISOString\(\)/);
  assert.match(adminRoute, /updatePayload\.unread_admin_count = 0;\s*updatePayload\.admin_read_at = new Date\(\)\.toISOString\(\);/);
  const route = read("src/app/api/internal/background-jobs/route.ts");
  assert.ok(route.indexOf("authorize_email_worker") < route.indexOf("readBoundedJsonBody(request"));
  assert.match(route, /task === "support-chat-notices"[\s\S]*runSupportChatNotices/);
  const sql = read("supabase/migrations/20261110150000_support_chat_admin_notices.sql");
  assert.match(sql, /m\.sender_type = 'VISITOR'/);
  assert.match(sql, /m\.created_at <= now\(\) - interval '1 minute'/);
  assert.match(sql, /m\.created_at > now\(\) - interval '1 day'/);
  assert.match(sql, /for update of c skip locked/);
  assert.match(sql, /grant execute on function public\.claim_support_chat_admin_notices\(integer\)\s+to service_role/);
  assert.match(sql, /revoke all on function public\.dispatch_support_chat_notices\(\) from public, anon, authenticated/);
  assert.match(sql, /cron\.schedule\('onside-support-chat-notices', '\* \* \* \* \*'/);
});
