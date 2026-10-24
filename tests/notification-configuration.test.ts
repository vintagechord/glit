import assert from "node:assert/strict";
import test from "node:test";
import { getKakaoConfiguration } from "../src/lib/kakao-config";
import { sendKakaoOfficialNotification } from "../src/lib/kakao";
import { runRuntimeConfigChecks, summarizeRuntimeHealth } from "../src/lib/runtime-health";
import { getEmailDeliveryConfiguration } from "../src/lib/email-config";
import { sendSubmissionUpdateEmail } from "../src/lib/email";
import { setEmailOutboxTestDispatcher } from "../src/lib/email-transport";

test("Kakao sender and readiness share alternate webhook configuration", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  try {
    process.env.KAKAO_ALIMTALK_WEBHOOK_URL = " ";
    process.env.KAKAO_NOTIFICATION_WEBHOOK_URL = "https://notify.fixture.invalid/hook";
    process.env.KAKAO_NOTIFICATION_API_KEY = "fixture-key";
    delete process.env.KAKAO_ALIMTALK_API_KEY;
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(String(input));
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fixture-key");
      return Response.json({ ok: true });
    };
    const health = runRuntimeConfigChecks({ includeOptionalNotifications: true }).find((check) => check.name === "kakao notification env");
    assert.equal(health?.ok, true);
    assert.deepEqual(await sendKakaoOfficialNotification({ phone: "010-0000-0000", title: "fixture", message: "fixture" }), { ok: true });
    assert.equal(calls.length, 1);
    process.env.KAKAO_NOTIFICATION_WEBHOOK_URL = "https://secret@notify.fixture.invalid/hook";
    assert.equal(runRuntimeConfigChecks({ includeOptionalNotifications: true }).find((check) => check.name === "kakao notification env")?.ok, false);
    assert.deepEqual(await sendKakaoOfficialNotification({ phone: "01000000000", title: "fixture", message: "fixture" }), { ok: false, skipped: true });
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(getKakaoConfiguration()), /secret/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});

test("required email configuration cannot pass readiness as an optional warning", () => {
  assert.equal(getEmailDeliveryConfiguration({ apiKey: " ", from: "notify@example.invalid" }).ok, false);
  assert.equal(summarizeRuntimeHealth([{ name: "email env", ok: false, severity: "error" }]).ok, false);
  assert.equal(getKakaoConfiguration({}).ok, false);
});

test("notification transports preserve idempotency and only return safe provider IDs", async () => {
  const env = { ...process.env }, fetchBefore = globalThis.fetch;
  try {
    Object.assign(process.env, { NODE_ENV: "test" });
    setEmailOutboxTestDispatcher(async (_message, deliver) => deliver());
    process.env.RESEND_API_KEY = "fixture-key";
    process.env.RESEND_FROM = "notify@example.invalid";
    process.env.KAKAO_ALIMTALK_WEBHOOK_URL = "https://notify.fixture.invalid/hook";
    let providerId = "fixture-message-id";
    globalThis.fetch = async (_input, init) => {
      assert.equal((init?.headers as Record<string,string>)["Idempotency-Key"], "supplement-fixture-state");
      return Response.json({ id: providerId });
    };
    const payload = { email: "recipient@example.invalid", title: "fixture", kind: "ALBUM" as const, headline: "fixture", summary: "fixture", idempotencyKey: "supplement-fixture-state" };
    assert.deepEqual(await sendSubmissionUpdateEmail(payload), { ok: true, messageId: "fixture-message-id" });
    assert.deepEqual(await sendKakaoOfficialNotification({ phone: "01000000000", title: "fixture", message: "fixture", idempotencyKey: "supplement-fixture-state" }), { ok: true, messageId: "fixture-message-id" });
    providerId = "private@example.invalid/token";
    assert.equal((await sendSubmissionUpdateEmail(payload)).ok, false);
  } finally {
    setEmailOutboxTestDispatcher(undefined);
    globalThis.fetch = fetchBefore;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
