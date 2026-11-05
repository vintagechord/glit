import assert from "node:assert/strict";
import test from "node:test";

import { classifySmtpRejection } from "../src/lib/email-transport";

test("SMTP 5xx: bad addresses stop, policy and spam refusals are retried within the outbox limit", () => {
  assert.deepEqual(classifySmtpRejection(550, "5.1.1"), { outcome: "failed", errorCode: "smtp_550_5_1_1" });
  assert.deepEqual(classifySmtpRejection(553, undefined), { outcome: "failed", errorCode: "smtp_553" });
  assert.deepEqual(classifySmtpRejection(550, undefined), { outcome: "failed", errorCode: "smtp_550" });
  assert.deepEqual(classifySmtpRejection(554, "5.7.1"), { outcome: "retry", errorCode: "smtp_554_5_7_1" });
  assert.deepEqual(classifySmtpRejection(550, "5.7.1"), { outcome: "retry", errorCode: "smtp_550_5_7_1" });
  assert.deepEqual(classifySmtpRejection(552, undefined), { outcome: "retry", errorCode: "smtp_552" });
  // Only digits reach the stored code; anything else is dropped.
  assert.deepEqual(classifySmtpRejection("554 secret@example.invalid", "x"), { outcome: "retry", errorCode: "smtp_5xx" });
  assert.match(classifySmtpRejection(554, "5.7.1").errorCode, /^[a-z0-9_]{1,64}$/);
});
