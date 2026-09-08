import assert from "node:assert/strict";
import test from "node:test";

import { runRuntimeConfigChecks } from "../src/lib/runtime-health";

test("email health rejects missing or unusable senders even when a support inbox exists", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = "private-fixture-api-key";
  try {
    for (const from of [
      undefined, "", "onside <private-sender@daum.net>", "private-sender@GMAIL.COM",
      "onboarding@resend.dev", "private-sender@example.invalid\r\nBcc: private-recipient@example.invalid",
    ]) {
      if (from === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = from;
      const check = runRuntimeConfigChecks({ strict: true }).find((entry) => entry.name === "email env");
      assert.ok(check);
      assert.equal(check.ok, false);
      assert.equal(check.severity, "error");
      assert.ok(check.detail);
      assert.doesNotMatch(JSON.stringify(check), /private-fixture|private-sender|private-recipient/);
    }
    process.env.RESEND_FROM = "onside <notify@example.invalid>";
    assert.deepEqual(runRuntimeConfigChecks({ strict: true }).find((entry) => entry.name === "email env"), {
      name: "email env", ok: true, severity: "error", detail: undefined,
    });
    delete process.env.RESEND_API_KEY;
    const missingKey = runRuntimeConfigChecks({ includeOptionalNotifications: true }).find((entry) => entry.name === "email env");
    assert.equal(missingKey?.ok, false);
    assert.equal(missingKey?.severity, "warning");
    assert.match(missingKey?.detail ?? "", /RESEND_API_KEY/);
  } finally {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = originalFrom;
  }
});
