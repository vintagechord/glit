import assert from "node:assert/strict";
import test from "node:test";

import { sendPasswordResetEmail } from "../src/lib/email";

test("password reset mail reports delivery failures without exposing credentials or pretending success", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = "fixture-only";
  process.env.RESEND_FROM = "onside <noreply@example.invalid>";
  let requests = 0;
  try {
    for (const [status, reason] of [[403, "configuration"], [429, "rate_limit"], [503, "delivery"]] as const) {
      globalThis.fetch = async () => {
        requests += 1;
        return new Response(JSON.stringify({ message: "private provider payload" }), {
          status,
          headers: { "Retry-After": "90" },
        });
      };
      const result = await sendPasswordResetEmail({
        email: "qa@example.invalid",
        link: "https://onside.example/reset-password?token_hash=fixture-token",
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.doesNotMatch(JSON.stringify(result), /private provider|fixture-token/);
      if (status === 429) assert.equal(result.retryAfterSeconds, 90);
    }
    assert.equal(requests, 3);
    const invalid = await sendPasswordResetEmail({ email: "qa@example.invalid", link: "javascript:alert(1)" });
    assert.equal(invalid.reason, "configuration");
    assert.equal(requests, 3, "invalid reset links must never be sent");

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { html: string };
      assert.match(body.html, /token_hash=fixture-token&amp;type=recovery/);
      return new Response(JSON.stringify({ id: "fixture-id" }), { status: 200 });
    };
    assert.equal((await sendPasswordResetEmail({
      email: "qa@example.invalid",
      link: "https://onside.example/reset-password?token_hash=fixture-token&type=recovery",
    })).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = originalFrom;
  }
});
