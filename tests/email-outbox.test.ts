import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createEmailOutboxService, type EmailOutboxRow, type EmailOutboxStats, type EmailOutboxStore } from "../src/lib/email-outbox";
import { sendEmailAttempt, sendTransactionalEmail, setEmailOutboxTestDispatcher, type EmailAttemptResult, type EmailMessage } from "../src/lib/email-transport";

const message: EmailMessage = { to: "recipient@example.invalid", subject: "Fixture", html: "<p>private-token</p>", operation: "submission update", idempotencyKey: "same-event", includeMessageId: true };
const accepted: EmailAttemptResult = { ok: true, outcome: "accepted", messageId: "fixture-accepted" };
function fixture(deliver: Parameters<typeof createEmailOutboxService>[0]["deliver"]) {
  let now = Date.parse("2026-10-25T00:00:00Z");
  const rows = new Map<string, EmailOutboxRow>();
  const calls: string[] = [];
  const store: EmailOutboxStore = {
    async enqueue(input) {
      calls.push("enqueue");
      const previous = [...rows.values()].find(row => row.idempotency_key === input.idempotency_key);
      if (previous) return { ...previous };
      const row: EmailOutboxRow = { ...input, id: randomUUID(), status: "pending", attempt_count: 0, max_attempts: 5, lease_token: null, lease_expires_at: null, next_attempt_at: new Date(now).toISOString(), provider_message_id: null, last_error_reason: null, last_error_code: null, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
      rows.set(row.id, row); return { ...row };
    },
    async claim(limit, id) {
      calls.push(id ? `claim:${id}` : "claim:batch");
      return [...rows.values()].filter(row => (!id || row.id === id) && ["pending", "retry"].includes(row.status) && Date.parse(row.next_attempt_at) <= now).slice(0, limit).map(row => {
        row.status = "sending"; row.attempt_count++; row.lease_token = randomUUID(); return { ...row };
      });
    },
    async finish(row, result) {
      calls.push("finish");
      const current = rows.get(row.id)!;
      assert.equal(current.lease_token, row.lease_token);
      current.status = result.outcome === "retry" && current.attempt_count >= current.max_attempts ? "failed" : result.outcome;
      current.last_error_code = result.errorCode ?? null; current.last_error_reason = result.reason ?? null;
      current.provider_message_id = result.messageId ?? null; current.lease_token = null;
      current.next_attempt_at = new Date(now + 30_000 * 2 ** (row.attempt_count - 1)).toISOString();
      if (result.outcome === "accepted") current.html = null;
      return { ...current };
    },
    async get(id) { return rows.get(id) ?? null; },
    async stats() { return {} as EmailOutboxStats; },
  };
  const service = createEmailOutboxService({ store, deliver: async (...args) => { calls.push("deliver"); return deliver(...args); }, now: () => now });
  return { service, store, rows, calls, advance: (ms: number) => { now += ms; }, now: () => now };
}
async function withEnv(run: () => Promise<void>) {
  const env = { ...process.env }; const fetch = globalThis.fetch; const error = console.error;
  Object.assign(process.env, { NEXT_PUBLIC_EMAIL_DELIVERY_MODE: "transactional" });
  globalThis.fetch = async () => { throw Error("Unexpected network call"); };
  console.error = () => {};
  try { await run(); } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env); globalThis.fetch = fetch; console.error = error;
  }
}

test("durable enqueue precedes delivery, claims only its own ID, and acceptance clears body", async () => {
  const f = fixture(async request => { assert.match(request.idempotencyKey!, /^outbox-/); assert.equal(request.requestId, request.idempotencyKey!.slice(7)); return accepted; });
  const result = await f.service.enqueueAndSend({ ...message, submissionId: "11111111-1111-4111-8111-111111111111", markResultNotified: true }, "supabase-smtp", "support@example.invalid");
  assert.equal(result.ok, true); assert.equal(result.status, "accepted");
  assert.deepEqual(f.calls, ["enqueue", `claim:${result.outboxId}`, "deliver", "finish"]);
  const row = f.rows.get(result.outboxId!)!;
  assert.equal(row.html, null); assert.equal(row.mark_result_notified, true);
  assert.equal(row.reply_to, "support@example.invalid"); assert.match(row.idempotency_key, /^[a-f0-9]{64}$/);
});

test("concurrent identical logical keys and later repeats do not send twice", async () => {
  let attempts = 0;
  const f = fixture(async () => { attempts++; await new Promise(resolve => setTimeout(resolve, 5)); return accepted; });
  const results = await Promise.all([f.service.enqueueAndSend(message, "supabase-smtp"), f.service.enqueueAndSend(message, "supabase-smtp")]);
  assert.equal(attempts, 1); assert.equal(f.rows.size, 1);
  assert.equal(results[0].outboxId, results[1].outboxId);
  assert.equal((await f.service.enqueueAndSend(message, "supabase-smtp")).ok, true);
  assert.equal(attempts, 1);
});

test("definite temporary failures retry later with one stable provider key", async () => {
  await withEnv(async () => {
    const keys: string[] = []; let attempts = 0;
    const f = fixture(async request => { keys.push(request.idempotencyKey!); return ++attempts === 1 ? { ok: false, outcome: "retry", reason: "rate_limit", errorCode: "smtp_temporary_rejection" } : accepted; });
    const first = await f.service.enqueueAndSend(message, "supabase-smtp");
    assert.equal(first.ok, false); assert.equal(first.queued, true); assert.equal(first.status, "retry");
    assert.equal((await f.service.drain()).claimed, 0);
    f.advance(30_000);
    assert.deepEqual(await f.service.drain(), { claimed: 1, accepted: 1, retry: 0, uncertain: 0, failed: 0, expired: 0 });
    assert.equal(keys[0], keys[1]); assert.equal(f.rows.get(first.outboxId!)!.html, null);
  });
});

test("uncertain acceptance and failed receipt persistence never auto resend", async () => {
  await withEnv(async () => {
    for (const persistFailure of [false, true]) {
      let attempts = 0;
      const f = fixture(async () => { attempts++; return persistFailure ? accepted : { ok: false, outcome: "uncertain", reason: "delivery", errorCode: "acceptance_unknown" }; });
      if (persistFailure) f.store.finish = async () => { throw Error("private database error"); };
      const result = await f.service.enqueueAndSend(message, "supabase-smtp");
      assert.equal(result.ok, false); assert.equal(result.status, "uncertain"); assert.equal(result.queued, false);
      f.advance(120_000); assert.equal((await f.service.drain()).claimed, 0); assert.equal(attempts, 1);
      assert.doesNotMatch(JSON.stringify(result), /private database|private-token/);
    }
  });
});

test("enqueue failure sends nothing and auth content uses a short expiry", async () => {
  await withEnv(async () => {
    let attempts = 0;
    const f = fixture(async () => { attempts++; return accepted; });
    f.store.enqueue = async () => { throw Error("private-token"); };
    assert.equal((await f.service.enqueueAndSend(message, "supabase-smtp")).ok, false); assert.equal(attempts, 0);
    const auth = fixture(async () => ({ ok: false, outcome: "retry", reason: "delivery", errorCode: "connection_unavailable" }));
    const result = await auth.service.enqueueAndSend({ ...message, operation: "password reset", idempotencyKey: undefined }, "supabase-smtp");
    assert.equal(Date.parse(auth.rows.get(result.outboxId!)!.expires_at) - auth.now(), 600_000);
    const invalid = await auth.service.enqueueAndSend({ ...message, expiresAt: "invalid" }, "supabase-smtp");
    assert.equal(invalid.ok, false); assert.equal(auth.rows.size, 1);
  });
});

test("production missing sender is recorded durably as failed and test bypass is forbidden", async () => {
  await withEnv(async () => {
    Object.assign(process.env, { NODE_ENV: "production", EMAIL_PROVIDER: "supabase-smtp", SUPABASE_URL: "https://fixtureproject.supabase.co", SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", SUPABASE_EMAIL_RELAY_URL: "https://fixtureproject.supabase.co/functions/v1/send-transactional-email", EMAIL_RELAY_SECRET: "a1".repeat(32) });
    delete process.env.SMTP_FROM;
    assert.throws(() => setEmailOutboxTestDispatcher(async (_message, deliver) => deliver()), /requires NODE_ENV=test/);
    let row: EmailOutboxRow; const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const name = String(input).split("/").at(-1)!; calls.push(name);
      assert.ok(String(input).startsWith("https://fixtureproject.supabase.co/rest/v1/rpc/"));
      const args = JSON.parse(String(init?.body));
      if (name === "enqueue_email_outbox") row = { id: "11111111-1111-4111-8111-111111111111", idempotency_key: args.p_idempotency_key, provider: args.p_provider, recipient_email: args.p_recipient_email, subject: args.p_subject, html: args.p_html, reply_to: args.p_reply_to, operation: args.p_operation, expires_at: args.p_expires_at, status: "pending", attempt_count: 0, max_attempts: 5, lease_token: null, lease_expires_at: null, next_attempt_at: new Date().toISOString(), provider_message_id: null, last_error_code: null, last_error_reason: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      else if (name === "claim_email_outbox") { assert.equal(args.p_id, row!.id); row!.status = "sending"; row!.lease_token = randomUUID(); }
      else if (name === "finish_email_outbox") { assert.equal(args.p_outcome, "failed"); row!.status = "failed"; row!.last_error_reason = args.p_error_reason; }
      else assert.fail(`Unexpected RPC: ${name}`);
      return Response.json([row!]);
    };
    const result = await sendTransactionalEmail(message);
    assert.equal(result.status, "failed"); assert.equal(result.reason, "configuration");
    assert.deepEqual(calls, ["enqueue_email_outbox", "claim_email_outbox", "finish_email_outbox"]);
  });
});

test("HTTP provider acknowledgement must be valid; ambiguous sends become uncertain", async () => {
  await withEnv(async () => {
    for (const provider of ["resend", "gmail"]) {
      Object.assign(process.env, { EMAIL_PROVIDER: provider, RESEND_API_KEY: "fixture", RESEND_FROM: "sender@example.invalid", GMAIL_CLIENT_ID: "fixture", GMAIL_CLIENT_SECRET: "fixture", GMAIL_REFRESH_TOKEN: "fixture", GMAIL_FROM: "fixture@gmail.com" });
      for (const malformed of [false, true]) {
        globalThis.fetch = async input => String(input).endsWith("/token") ? Response.json({ access_token: "fixture" }) : malformed ? new Response("invalid JSON") : Response.json({});
        const result = await sendEmailAttempt(message);
        assert.equal(result.ok, false); assert.equal(result.outcome, "uncertain"); assert.equal(result.errorCode, "invalid_provider_ack");
      }
    }
  });
});
