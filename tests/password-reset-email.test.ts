import assert from "node:assert/strict";
import test from "node:test";

import { APP_CONFIG } from "../src/lib/config";
import { sendPasswordResetEmail } from "../src/lib/email";

const recipient = "private-recipient@example.invalid";
const recoveryLink = "https://onside.example/reset-password?token_hash=private-recovery-token&type=recovery";
const sender = "onside <noreply@example.invalid>";
const sensitive = /private-recipient|private-recovery-token|private provider payload|fixture-api-key|raw-provider-name/;

async function withMailFixture(run: (logs: unknown[][]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;
  const originalSupport = APP_CONFIG.supportEmail;
  const logs: unknown[][] = [];
  process.env.RESEND_API_KEY = "fixture-api-key";
  process.env.RESEND_FROM = sender;
  APP_CONFIG.supportEmail = "support-fixture@daum.net";
  console.error = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = async () => { throw new Error("Unexpected network request in email fixture"); };
  try {
    await run(logs);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    APP_CONFIG.supportEmail = originalSupport;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = originalFrom;
  }
}

test("invalid sender settings and recovery links never invoke the email provider", async () => {
  await withMailFixture(async (logs) => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ id: "fixture-id" }), { status: 200 });
    };
    for (const from of [
      undefined, "", "onside <myonside@daum.net>", "notify@gmail.com", "onboarding@resend.dev",
      "not-an-email", "notify@example.invalid\r\nBcc: private-recipient@example.invalid",
    ]) {
      if (from === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = from;
      const result = await sendPasswordResetEmail({ email: recipient, link: recoveryLink });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "configuration");
      assert.doesNotMatch(JSON.stringify(result), sensitive);
    }
    process.env.RESEND_FROM = sender;
    for (const link of ["javascript:alert(1)", "not-a-url", "https://private-recipient:secret@example.invalid/reset"]) {
      const result = await sendPasswordResetEmail({ email: recipient, link });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "configuration");
    }
    delete process.env.RESEND_API_KEY;
    assert.equal((await sendPasswordResetEmail({ email: recipient, link: recoveryLink })).reason, "configuration");
    assert.equal(requests, 0);
    assert.doesNotMatch(JSON.stringify(logs), sensitive);
  });
});

test("password reset sends from the configured sender and preserves support as reply-to", async () => {
  await withMailFixture(async (logs) => {
    let requests = 0;
    globalThis.fetch = async (url, options) => {
      requests += 1;
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options?.method, "POST");
      assert.ok(options.signal instanceof AbortSignal, "email requests must have a bounded timeout");
      const body = JSON.parse(String(options.body)) as { from: string; to: string; reply_to?: string; html: string };
      assert.equal(body.from, sender);
      assert.equal(body.to, recipient);
      assert.equal(body.reply_to, APP_CONFIG.supportEmail);
      assert.match(body.html, /token_hash=private-recovery-token&amp;type=recovery/);
      return new Response(JSON.stringify({ id: "fixture-id" }), { status: 200 });
    };
    assert.deepEqual(await sendPasswordResetEmail({ email: recipient, link: recoveryLink }), { ok: true });
    assert.equal(requests, 1);
    assert.deepEqual(logs, []);
  });
});

test("provider failures expose only safe classifications and documented diagnostic names", async () => {
  await withMailFixture(async (logs) => {
    let requests = 0;
    const cases = [
      [400, "configuration", "validation_error"],
      [401, "configuration", "missing_api_key"],
      [403, "configuration", "restricted_api_key"],
      [422, "configuration", "invalid_parameter"],
      [429, "rate_limit", "daily_quota_exceeded"],
      [503, "delivery", "service_unavailable"],
    ] as const;
    for (const [status, reason, name] of cases) {
      globalThis.fetch = async () => {
        requests += 1;
        return new Response(JSON.stringify({ name, message: "private provider payload", recipient, link: recoveryLink }), {
          status, headers: { "Retry-After": "90" },
        });
      };
      const result = await sendPasswordResetEmail({ email: recipient, link: recoveryLink });
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.doesNotMatch(JSON.stringify(result), sensitive);
      assert.deepEqual(logs.at(-1), ["[Email] password reset rejected", {
        status, reason, diagnostic: "resend_" + name,
      }]);
      if (status === 429) assert.equal(result.retryAfterSeconds, 90);
    }
    assert.equal(requests, cases.length);
    for (const body of [
      JSON.stringify({ name: "raw-provider-name private-recipient", message: recoveryLink }),
      JSON.stringify({ name: { nested: "validation_error" }, message: recipient }),
      "private provider payload invalid JSON",
    ]) {
      globalThis.fetch = async () => new Response(body, { status: 403 });
      const result = await sendPasswordResetEmail({ email: recipient, link: recoveryLink });
      assert.equal(result.reason, "configuration");
      assert.deepEqual(logs.at(-1), ["[Email] password reset rejected", {
        status: 403, reason: "configuration", diagnostic: "email_configuration_error",
      }]);
    }
    assert.doesNotMatch(JSON.stringify(logs), sensitive);
  });
});

test("rate-limit retry delays are bounded and missing provider hints use a safe default", async () => {
  await withMailFixture(async () => {
    for (const [retryAfter, expected] of [["36000", 3600], ["1.5", 2], ["-1", 60], ["invalid", 60], ["", 60]] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({ name: "rate_limit_exceeded" }), {
        status: 429, headers: { "Retry-After": retryAfter },
      });
      assert.equal((await sendPasswordResetEmail({ email: recipient, link: recoveryLink })).retryAfterSeconds, expected);
    }
  });
});

test("timeouts and thrown transport errors never pretend delivery or leak request data", async () => {
  await withMailFixture(async (logs) => {
    for (const error of [
      new DOMException("private provider payload " + recoveryLink, "TimeoutError"),
      new TypeError("private-recipient " + recoveryLink),
      Object.assign(new Error("private provider payload"), { name: "raw-provider-name private-recipient" }),
    ]) {
      let requests = 0;
      globalThis.fetch = async (_url, options) => {
        requests += 1;
        assert.ok(options?.signal instanceof AbortSignal);
        throw error;
      };
      const result = await sendPasswordResetEmail({ email: recipient, link: recoveryLink });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "delivery");
      assert.equal(requests, 1, "uncertain transport failures must not cause an automatic duplicate send");
      assert.doesNotMatch(JSON.stringify(result), sensitive);
    }
    assert.doesNotMatch(JSON.stringify(logs), sensitive);
  });
});
