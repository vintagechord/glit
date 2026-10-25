import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { getEmailDeliveryMode } from "../src/lib/email-delivery-mode";
import { getEmailDeliveryConfiguration } from "../src/lib/email-config";
import {
  sendWelcomeEmail, sendPasswordResetEmail, sendSubmissionReceiptEmail,
  sendResultEmail, sendOrderBankTransferEmail, sendSubmissionUpdateEmail,
  sendGuestSubmissionLookupEmail,
} from "../src/lib/email";
import { runRuntimeConfigChecks, summarizeRuntimeHealth } from "../src/lib/runtime-health";
import { buildRuntimeHealthPayload } from "../src/lib/runtime-health-response";

const restoreEnv = (before: NodeJS.ProcessEnv) => {
  for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
  Object.assign(process.env, before);
};

test("delivery mode defaults to transactional and rejects unknown or blank configured modes", () => {
  const before = { ...process.env };
  try {
    delete process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE;
    assert.equal(getEmailDeliveryMode(), "transactional");
    assert.equal(getEmailDeliveryMode("manual"), "manual");
    assert.equal(getEmailDeliveryMode(" transactional "), "transactional");
    for (const value of ["", " ", "MANUAL", "disabled", "private-invalid-value"]) {
      assert.equal(getEmailDeliveryMode(value), "invalid");
    }
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "manual";
    assert.equal(getEmailDeliveryMode(), "manual");
  } finally { restoreEnv(before); }
});

test("manual and invalid modes suppress every email transport even with otherwise valid provider credentials", async () => {
  const before = { ...process.env }, fetchBefore = globalThis.fetch;
  let calls = 0;
  try {
    process.env.RESEND_API_KEY = "fixture-valid-provider-key";
    process.env.RESEND_FROM = "notify@example.invalid";
    globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
    for (const mode of ["manual", "invalid-value"]) {
      process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = mode;
      const config = getEmailDeliveryConfiguration();
      assert.equal(config.ok, false);
      assert.equal(config.apiKey, "");
      assert.equal(config.from, "");
      assert.doesNotMatch(config.diagnostic ?? "", /fixture-valid-provider-key|invalid-value/);
      const results = await Promise.all([
        sendWelcomeEmail({ email: "fixture@example.invalid" }),
        sendPasswordResetEmail({ email: "fixture@example.invalid", link: "https://app.fixture.invalid/reset-password?token_hash=fixture" }),
        sendSubmissionReceiptEmail({ email: "fixture@example.invalid", title: "fixture", kind: "ALBUM", submissionId: "fixture" }),
        sendResultEmail({ email: "fixture@example.invalid", title: "fixture", resultStatus: "APPROVED" }),
        sendOrderBankTransferEmail({ email: "fixture@example.invalid", orderId: "fixture-order", items: [{ title: "fixture", kind: "ALBUM", amountKrw: 50000 }], totalAmountKrw: 50000 }),
        sendSubmissionUpdateEmail({ email: "fixture@example.invalid", title: "fixture", kind: "ALBUM", headline: "fixture", summary: "fixture" }),
        sendGuestSubmissionLookupEmail({ email: "fixture@example.invalid", items: [{ token: "fixture-token", link: "https://app.fixture.invalid/track/fixture-token" }] }),
      ]);
      assert.ok(results.every(result => !result.ok && result.skipped));
      if (mode === "manual") assert.ok(results.every(result => result.message?.includes("현재 이메일 자동 발송을 제공하지 않습니다")));
      assert.equal(calls, 0);
    }
  } finally { globalThis.fetch = fetchBefore; restoreEnv(before); }
});

test("manual readiness is an explicit warning while database, storage and payment failures still block readiness", async () => {
  const before = { ...process.env };
  try {
    Object.assign(process.env, {
      NEXT_PUBLIC_EMAIL_DELIVERY_MODE: "manual",
      NEXT_PUBLIC_SITE_URL: "https://app.fixture.invalid",
      NEXT_PUBLIC_SUPABASE_URL: "https://manual-fixture.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-key", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
      B2_S3_ENDPOINT: "https://storage.fixture.invalid", B2_REGION: "fixture", B2_BUCKET: "fixture",
      B2_KEY_ID: "fixture", B2_APPLICATION_KEY: "fixture",
      INICIS_ENV: "prod", INICIS_MID_PROD: "fixture", INICIS_SIGN_KEY_PROD: "fixture",
      RESEND_API_KEY: "fixture-provider-key", RESEND_FROM: "notify@example.invalid",
    });
    const checks = runRuntimeConfigChecks({ includeOptionalNotifications: true });
    const deferred = checks.find(check => check.name === "email delivery deferred");
    assert.equal(deferred?.ok, false);
    assert.equal(deferred?.severity, "warning");
    assert.equal(checks.some(check => check.name === "email env"), false);
    assert.equal(summarizeRuntimeHealth(checks).ok, true);
    for (const field of ["B2_KEY_ID", "INICIS_SIGN_KEY_PROD", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
      const value = process.env[field]; delete process.env[field];
      const failed = runRuntimeConfigChecks({ includeOptionalNotifications: true });
      assert.equal(summarizeRuntimeHealth(failed).ok, false, `${field} stays required`);
      process.env[field] = value;
    }
    const disconnected = await buildRuntimeHealthPayload(async () => [{ name: "supabase auth connectivity", ok: false, severity: "error" }]);
    assert.equal(disconnected.status, 503);
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "invalid-value";
    assert.equal(runRuntimeConfigChecks({ includeOptionalNotifications: true }).find(check => check.name === "email delivery mode")?.severity, "error");
    assert.equal(summarizeRuntimeHealth(runRuntimeConfigChecks({ includeOptionalNotifications: true })).ok, false);
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "transactional";
    delete process.env.RESEND_API_KEY;
    const transactional = runRuntimeConfigChecks({ includeOptionalNotifications: true }).find(check => check.name === "email env");
    assert.equal(transactional?.ok, false);
    assert.equal(transactional?.severity, "error");
  } finally { restoreEnv(before); }
});

test("deferred lookup-code recovery returns support guidance before customer queries, body reads, or email calls", async () => {
  const before = { ...process.env };
  const result = await build({ stdin: { contents: "export * from './src/app/api/track/lookup-code/route'; export {calls} from 'lookup-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "lookup-manual-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(lookup-fixture|@\/lib\/(?:email|supabase\/admin|request-rate-limit|request-body))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {calls} from 'lookup-fixture';";
        const files: Record<string, string> = {
          "lookup-fixture": "export const calls=[];",
          "@/lib/email": `${shared} export async function sendGuestSubmissionLookupEmail(){calls.push('email');throw new Error('Unexpected email');}`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){calls.push('database');throw new Error('Unexpected database access');}`,
          "@/lib/request-rate-limit": `${shared} export const consumePersistentRateLimit=()=>{calls.push('limit');return {allowed:true}};export const getRequestIdentifier=()=>{calls.push('ip');return 'fixture'};`,
          "@/lib/request-body": `${shared} export async function readBoundedJsonBody(){calls.push('body');throw new Error('Unexpected body read');}`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  const bundled = { exports: {} as { POST: (request: NextRequest) => Promise<Response>; calls: string[] } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  try {
    for (const mode of ["manual", "invalid-value"]) {
      process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = mode;
      const response = await bundled.exports.POST(new NextRequest("https://app.fixture.invalid/api/track/lookup-code", { method: "POST", body: JSON.stringify({ name: "fixture", email: "fixture@example.invalid" }) }));
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.match(body.error, /고객센터/);
      assert.doesNotMatch(JSON.stringify(body), /fixture@example|token|invalid-value/);
      assert.deepEqual(bundled.exports.calls, []);
    }
  } finally { restoreEnv(before); }
});
