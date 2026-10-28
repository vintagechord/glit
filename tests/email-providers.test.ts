import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { getEmailDeliveryConfiguration, getEmailSenderConfiguration } from "../src/lib/email-config";
import { setEmailOutboxTestDispatcher } from "../src/lib/email-transport";
import {
  sendGuestSubmissionLookupEmail, sendPasswordResetEmail, sendResultEmail,
  sendSignupVerificationEmail, sendOrderBankTransferEmail, sendSubmissionReceiptEmail,
  sendSubmissionUpdateEmail, sendWelcomeEmail,
} from "../src/lib/email";

const recipient = "private-recipient@example.invalid";
const link = "https://app.example.invalid/reset-password?token_hash=private-token&type=recovery";
const sensitive = /private-recipient|private-token|private-password|private-secret|private-refresh|private-access|private-provider/;
const smtpEnv = { EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.daum.net", SMTP_PORT: "465", SMTP_USER: "private-sender@daum.net", SMTP_PASS: "private-password", SMTP_FROM: "온사이드 <private-sender@daum.net>" };
const gmailEnv = { EMAIL_PROVIDER: "gmail", GMAIL_CLIENT_ID: "fixture-client", GMAIL_CLIENT_SECRET: "private-secret", GMAIL_REFRESH_TOKEN: "private-refresh", GMAIL_FROM: "Onside <fixture@gmail.com>" };
const relaySecret = "a1".repeat(32);
const relayUrl = "https://fixtureproject.supabase.co/functions/v1/send-transactional-email";
const relayMessageId = "smtp-01234567-89ab-4def-8123-456789abcdef";
const relayEnv = {
  EMAIL_PROVIDER: "supabase-smtp", NEXT_PUBLIC_SUPABASE_URL: "https://fixtureproject.supabase.co",
  SUPABASE_URL: "",
  SUPABASE_EMAIL_RELAY_URL: relayUrl, EMAIL_RELAY_SECRET: relaySecret,
  SMTP_FROM: "온사이드 <private-sender@daum.net>",
};

function restoreEnv(env: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
}

async function withFixture(run: (logs: unknown[][]) => Promise<void>) {
  const env = { ...process.env }, fetch = globalThis.fetch, error = console.error;
  const logs: unknown[][] = [];
  Object.assign(process.env, { NODE_ENV: "test" });
  setEmailOutboxTestDispatcher(async (_message, deliver) => deliver());
  process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "transactional";
  console.error = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  try { await run(logs); } finally { setEmailOutboxTestDispatcher(undefined); restoreEnv(env); globalThis.fetch = fetch; console.error = error; }
}

test("authenticated mailbox providers permit public mailboxes while Resend keeps domain verification rules", async () => {
  await withFixture(async () => {
    for (const provider of ["smtp", "gmail", "supabase-smtp"] as const) assert.equal(getEmailSenderConfiguration({ from: "sender@daum.net", provider }).ok, true);
    assert.equal(getEmailSenderConfiguration({ from: "sender@daum.net", provider: "resend" }).ok, false);
    Object.assign(process.env, smtpEnv);
    delete process.env.RESEND_API_KEY;
    assert.equal(getEmailDeliveryConfiguration().ok, true);
    assert.equal(getEmailDeliveryConfiguration().smtp?.secure, true);
    process.env.SMTP_PORT = "587";
    assert.equal(getEmailDeliveryConfiguration().smtp?.secure, false);
    for (const port of ["", "25", "0", "465suffix", "2525"]) {
      process.env.SMTP_PORT = port;
      assert.equal(getEmailDeliveryConfiguration().ok, false);
    }
    Object.assign(process.env, smtpEnv);
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
      const value = process.env[key]; delete process.env[key];
      const config = getEmailDeliveryConfiguration();
      assert.equal(config.ok, false, key);
      assert.doesNotMatch(config.diagnostic ?? "", sensitive);
      process.env[key] = value;
    }
    Object.assign(process.env, gmailEnv);
    assert.equal(getEmailDeliveryConfiguration().ok, true);
    for (const key of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_FROM"]) {
      const value = process.env[key]; delete process.env[key];
      assert.equal(getEmailDeliveryConfiguration().ok, false, key);
      process.env[key] = value;
    }
    process.env.EMAIL_PROVIDER = "unknown";
    assert.equal(getEmailDeliveryConfiguration().ok, false);
  });
});

test("Supabase SMTP relay requires the same hosted project and its own secret, without SMTP credentials", async () => {
  await withFixture(async () => {
    Object.assign(process.env, relayEnv);
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY", "GMAIL_REFRESH_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[key];
    const ready = getEmailDeliveryConfiguration();
    assert.equal(ready.ok, true);
    assert.equal(ready.provider, "supabase-smtp");
    assert.equal(ready.smtp, undefined);
    assert.deepEqual(ready.relay, { url: relayUrl, secret: relaySecret });
    assert.equal(ready.from, relayEnv.SMTP_FROM);
    for (const url of [
      "", "not-a-url", relayUrl.replace("https:", "http:"),
      relayUrl.replace("fixtureproject", "anotherproject"),
      relayUrl.replace(".supabase.co", ".supabase.co.example.invalid"),
      relayUrl.replace("https://", "https://user:private-secret@"),
      relayUrl.replace(".co/", ".co:8443/"),
      relayUrl.replace("send-transactional-email", "other-function"),
      `${relayUrl}/`, `${relayUrl}?`, `${relayUrl}?key=private-secret`, `${relayUrl}#`, `${relayUrl}#private-token`,
      `${relayUrl}\n`, relayUrl.replace("/functions/", "/untrusted/../functions/"),
    ]) {
      process.env.SUPABASE_EMAIL_RELAY_URL = url;
      const config = getEmailDeliveryConfiguration();
      assert.equal(config.ok, false, url);
      assert.doesNotMatch(config.diagnostic ?? "", sensitive);
    }
    process.env.SUPABASE_EMAIL_RELAY_URL = relayUrl;
    for (const secret of ["", "a".repeat(63), "a".repeat(65), "g".repeat(64), `${relaySecret}\n`, "private-secret"]) {
      process.env.EMAIL_RELAY_SECRET = secret;
      assert.equal(getEmailDeliveryConfiguration().ok, false);
    }
    process.env.EMAIL_RELAY_SECRET = relaySecret;
    for (const project of ["", "http://fixtureproject.supabase.co", "https://fixtureproject.supabase.co.example.invalid", "https://fixtureproject.supabase.co/other", "https://user:private-secret@fixtureproject.supabase.co", "https://fixtureproject.supabase.co?private-token", "https://fixtureproject.supabase.co#private-token"]) {
      delete process.env.SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_URL = project;
      assert.equal(getEmailDeliveryConfiguration().ok, false, project);
    }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_URL = relayEnv.NEXT_PUBLIC_SUPABASE_URL;
    assert.equal(getEmailDeliveryConfiguration().ok, true, "server project URL fallback");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://differentproject.supabase.co";
    assert.equal(getEmailDeliveryConfiguration().ok, true, "server project must match the server auth client");
    process.env.SUPABASE_EMAIL_RELAY_URL = "https://differentproject.supabase.co/functions/v1/send-transactional-email";
    assert.equal(getEmailDeliveryConfiguration().ok, false, "a stale public project cannot receive the server's relay secret");
    Object.assign(process.env, relayEnv);
    delete process.env.SMTP_FROM;
    assert.equal(getEmailDeliveryConfiguration().ok, false, "sender is explicit");
  });
});

test("Supabase SMTP relay sends one HTTPS request with only the dedicated secret and expected payload", async context => {
  await withFixture(async logs => {
    Object.assign(process.env, relayEnv, { SUPABASE_SERVICE_ROLE_KEY: "private-service-role", SMTP_PASS: "private-password", RESEND_API_KEY: "private-resend-key" });
    const timeouts: number[] = [];
    context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    });
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), relayUrl);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(init?.headers, { Authorization: `Bearer ${relaySecret}`, "Content-Type": "application/json" });
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(body).sort(), body.replyTo ? ["html", "replyTo", "subject", "to"] : ["html", "subject", "to"]);
      assert.equal(body.to, recipient);
      assert.equal(typeof body.html, "string");
      assert.equal(typeof body.subject, "string");
      assert.doesNotMatch(String(init?.body), /private-service-role|private-password|private-resend-key/);
      assert.equal(String(init?.body).includes(relaySecret), false);
      requests.push(body);
      return Response.json({ ok: true, messageId: relayMessageId });
    };
    assert.deepEqual(await sendSignupVerificationEmail({ email: recipient, link }), { ok: true });
    assert.deepEqual(await sendPasswordResetEmail({ email: recipient, link }), { ok: true });
    assert.deepEqual(await sendSubmissionUpdateEmail({ email: recipient, title: "fixture", kind: "MV", headline: "fixture", summary: "fixture", idempotencyKey: "fixture-key" }), { ok: true, messageId: relayMessageId });
    assert.equal(requests.length, 3);
    assert.deepEqual(timeouts, [25000, 25000, 25000]);
    assert.deepEqual(logs, []);
  });
});

test("Supabase SMTP relay rejects ambiguous acceptance and exposes no private error details or retries", async () => {
  await withFixture(async logs => {
    Object.assign(process.env, relayEnv, smtpEnv, relayEnv, gmailEnv, relayEnv, { RESEND_API_KEY: "available-but-unused" });
    const cases: Array<{ body: unknown; status: number; reason: string }> = [
      { body: null, status: 200, reason: "delivery" },
      { body: {}, status: 200, reason: "delivery" },
      { body: { ok: true }, status: 200, reason: "delivery" },
      { body: { ok: "true", messageId: relayMessageId }, status: 200, reason: "delivery" },
      { body: { ok: true, messageId: "private-token" }, status: 200, reason: "delivery" },
      { body: { ok: true, messageId: `${relayMessageId}\nprivate-recipient` }, status: 200, reason: "delivery" },
      { body: { ok: false, messageId: relayMessageId }, status: 200, reason: "delivery" },
      { body: { ok: false, reason: "private-provider private-token" }, status: 200, reason: "delivery" },
      { body: { ok: false, reason: "configuration", message: "private-password" }, status: 401, reason: "configuration" },
      { body: { ok: false, reason: "rate_limit", message: "private-recipient" }, status: 429, reason: "rate_limit" },
      { body: { ok: false, reason: "delivery", message: "private-token" }, status: 502, reason: "delivery" },
      { body: { ok: true, messageId: relayMessageId }, status: 503, reason: "delivery" },
      { body: { message: "private-provider" }, status: 429, reason: "rate_limit" },
    ];
    for (const fixture of cases) {
      let requests = 0;
      globalThis.fetch = async input => {
        requests++;
        assert.equal(String(input), relayUrl);
        return Response.json(fixture.body, { status: fixture.status });
      };
      const result = await sendPasswordResetEmail({ email: recipient, link });
      assert.equal(result.ok, false);
      assert.equal(result.reason, fixture.reason);
      assert.equal(result.retryAfterSeconds, fixture.reason === "rate_limit" ? 60 : undefined);
      assert.equal(requests, 1);
      assert.doesNotMatch(JSON.stringify(result), sensitive);
      assert.equal(JSON.stringify(result).includes(relaySecret), false);
    }
    for (const fault of ["invalid-json", "redirect", "timeout"]) {
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        if (fault === "invalid-json") return new Response("private-provider private-token", { status: 200 });
        throw new Error(`private-provider ${relaySecret} private-recipient private-token`);
      };
      assert.equal((await sendPasswordResetEmail({ email: recipient, link })).reason, "delivery");
      assert.equal(requests, 1);
    }
    assert.doesNotMatch(JSON.stringify(logs), sensitive);
    assert.equal(JSON.stringify(logs).includes(relaySecret), false);
  });
});

test("Supabase SMTP relay manual mode, invalid configuration and invalid recipients prevent all requests", async () => {
  await withFixture(async () => {
    Object.assign(process.env, relayEnv);
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error("Unexpected relay request"); };
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "manual";
    assert.equal(getEmailDeliveryConfiguration().relay, undefined);
    assert.equal((await sendSignupVerificationEmail({ email: recipient, link })).skipped, true);
    assert.equal((await sendPasswordResetEmail({ email: recipient, link })).skipped, true);
    assert.equal((await sendSubmissionUpdateEmail({ email: recipient, title: "fixture", kind: "MV", headline: "fixture", summary: "fixture" })).skipped, true);
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "transactional";
    delete process.env.EMAIL_RELAY_SECRET;
    assert.equal((await sendPasswordResetEmail({ email: recipient, link })).reason, "configuration");
    Object.assign(process.env, relayEnv);
    process.env.SUPABASE_EMAIL_RELAY_URL = relayUrl.replace("fixtureproject", "anotherproject");
    assert.equal((await sendPasswordResetEmail({ email: recipient, link })).reason, "configuration");
    Object.assign(process.env, relayEnv);
    assert.equal((await sendPasswordResetEmail({ email: `${recipient},other@example.invalid`, link })).reason, "configuration");
    assert.equal(requests, 0);
  });
});

test("Gmail uses HTTPS OAuth and MIME for all auth mail without any SMTP or Resend request", async () => {
  await withFixture(async logs => {
    Object.assign(process.env, gmailEnv);
    const requests: string[] = [];
    const messages: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input); requests.push(url);
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init?.method, "POST");
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init.body));
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "private-refresh");
        assert.equal(body.get("client_secret"), "private-secret");
        return Response.json({ access_token: "private-access" });
      }
      assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer private-access");
      const raw = JSON.parse(String(init.body)).raw;
      assert.match(raw, /^[A-Za-z0-9_-]+$/);
      const mime = Buffer.from(raw, "base64url").toString("utf8");
      assert.match(mime, /From: Onside <fixture@gmail.com>/);
      assert.match(mime, /To: private-recipient@example.invalid/);
      assert.match(mime, /MIME-Version: 1.0/);
      assert.match(mime, /Content-Type: text\/html/);
      messages.push(mime);
      return Response.json({ id: "fixture-message-id" });
    };
    assert.equal((await sendSignupVerificationEmail({ email: recipient, link })).ok, true);
    assert.equal((await sendPasswordResetEmail({ email: recipient, link })).ok, true);
    assert.deepEqual(await sendSubmissionUpdateEmail({ email: recipient, title: "fixture", kind: "ALBUM", headline: "fixture", summary: "fixture" }), { ok: true, messageId: "fixture-message-id" });
    assert.equal(requests.length, 6);
    assert.equal(messages.length, 3);
    assert.deepEqual(logs, []);
  });
});

test("Gmail failures stay private, do not fall back, and never retry uncertain sends", async () => {
  await withFixture(async logs => {
    Object.assign(process.env, gmailEnv, { RESEND_API_KEY: "available-but-unused", RESEND_FROM: "sender@example.invalid" });
    for (const stage of ["refresh", "send", "timeout", "invalid-token"]) {
      let requests = 0;
      globalThis.fetch = async input => {
        requests++;
        if (String(input).endsWith("/token")) return stage === "refresh"
          ? Response.json({ error: "private-provider private-refresh" }, { status: 400 })
          : Response.json({ access_token: stage === "invalid-token" ? "bad\nheader" : "private-access" });
        if (stage === "timeout") throw new Error("private-provider private-access");
        return Response.json({ error: { message: "private-recipient private-token" } }, { status: 429, headers: { "retry-after": "120" } });
      };
      const result = await sendPasswordResetEmail({ email: recipient, link });
      assert.equal(result.ok, false);
      assert.equal(requests, stage === "refresh" || stage === "invalid-token" ? 1 : 2);
      if (stage === "send") assert.equal(result.retryAfterSeconds, 120);
      assert.doesNotMatch(JSON.stringify(result), sensitive);
    }
    for (const reason of ["dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded", "private-provider"]) {
      globalThis.fetch = async input => String(input).endsWith("/token")
        ? Response.json({ access_token: "private-access" })
        : Response.json({ error: { errors: [{ reason }], message: "private-recipient private-token" } }, { status: 403 });
      assert.equal((await sendPasswordResetEmail({ email: recipient, link })).reason, reason === "private-provider" ? "configuration" : "rate_limit");
    }
    let requests = 0; globalThis.fetch = async () => { requests++; throw new Error("Unexpected request"); };
    delete process.env.GMAIL_REFRESH_TOKEN;
    assert.equal((await sendPasswordResetEmail({ email: recipient, link })).reason, "configuration");
    Object.assign(process.env, gmailEnv);
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "manual";
    assert.equal((await sendPasswordResetEmail({ email: recipient, link })).skipped, true);
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "transactional";
    assert.equal((await sendPasswordResetEmail({ email: `${recipient},other@example.invalid`, link })).ok, false);
    assert.equal(requests, 0);
    assert.doesNotMatch(JSON.stringify(logs), sensitive);
  });
});

test("manual and invalid modes suppress every template including malformed link inputs", async () => {
  await withFixture(async () => {
    Object.assign(process.env, gmailEnv);
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error("Unexpected email"); };
    for (const mode of ["manual", "invalid"]) {
      process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = mode;
      const badLink = "javascript:private-token";
      const results = await Promise.all([
        sendWelcomeEmail({ email: recipient }),
        sendSignupVerificationEmail({ email: recipient, link: badLink }),
        sendPasswordResetEmail({ email: recipient, link: badLink }),
        sendGuestSubmissionLookupEmail({ email: recipient, items: [{ token: "private-token", link: badLink }] }),
        sendSubmissionReceiptEmail({ email: recipient, title: "fixture", kind: "ALBUM", submissionId: "fixture", link: badLink }),
        sendResultEmail({ email: recipient, title: "fixture", resultStatus: "APPROVED", link: badLink }),
        sendOrderBankTransferEmail({ email: recipient, orderId: "fixture-order", items: [{ title: "fixture", kind: "MV", amountKrw: 1000 }], totalAmountKrw: 1000, link: badLink }),
        sendSubmissionUpdateEmail({ email: recipient, title: "fixture", kind: "MV", headline: "fixture", summary: "fixture", link: badLink }),
      ]);
      assert.equal(results.every(result => !result.ok), true);
    }
    assert.equal(requests, 0);
  });
});

test("SMTP enforces TLS, isolates recipients, closes transports and reports rejection safely", async () => {
  const built = await build({ stdin: { contents: "export * from './src/lib/email'; export {setEmailOutboxTestDispatcher} from './src/lib/email-transport'; export {fixture} from 'smtp-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "smtp-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(smtp-fixture|nodemailer)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "smtp-fixture"
        ? "export const fixture={options:[],messages:[],closed:0,result:{accepted:['recipient'],rejected:[]},error:null};"
        : "import {fixture} from 'smtp-fixture'; export function createTransport(options){fixture.options.push(options);return {async sendMail(message){fixture.messages.push(message);if(fixture.error)throw fixture.error;return fixture.result},close(){fixture.closed++}}}" }));
    } }],
  });
  type Fixture = { options: Array<Record<string, unknown>>; messages: Array<Record<string, unknown>>; closed: number; result: { accepted: string[]; rejected: string[] }; error: unknown };
  const loaded = { exports: {} as { sendPasswordResetEmail: typeof sendPasswordResetEmail; sendSubmissionUpdateEmail: typeof sendSubmissionUpdateEmail; setEmailOutboxTestDispatcher: typeof setEmailOutboxTestDispatcher; fixture: Fixture } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  await withFixture(async logs => {
    Object.assign(process.env, smtpEnv);
    loaded.exports.setEmailOutboxTestDispatcher(async (_message, deliver) => deliver());
    const { fixture, sendPasswordResetEmail: send } = loaded.exports;
    assert.equal((await send({ email: recipient, link })).ok, true);
    let options = fixture.options.at(-1)!;
    assert.equal(options.secure, true);
    assert.equal(options.requireTLS, false);
    assert.equal(options.disableFileAccess, true);
    assert.equal(options.disableUrlAccess, true);
    assert.deepEqual(options.tls, { minVersion: "TLSv1.2", rejectUnauthorized: true });
    for (const name of ["connectionTimeout", "socketTimeout", "greetingTimeout", "dnsTimeout"]) assert.equal(options[name], 10000);
    assert.equal(fixture.messages[0].to, recipient);
    process.env.SMTP_PORT = "587";
    const update = await loaded.exports.sendSubmissionUpdateEmail({ email: recipient, title: "fixture", kind: "MV", headline: "fixture", summary: "fixture", idempotencyKey: "fixture-key" });
    assert.equal(update.ok, true); assert.match(update.messageId!, /^smtp-[a-f0-9-]+$/);
    options = fixture.options.at(-1)!;
    assert.equal(options.secure, false); assert.equal(options.requireTLS, true);
    fixture.result = { accepted: [], rejected: [recipient] };
    assert.equal((await send({ email: recipient, link })).ok, false);
    fixture.error = Object.assign(new Error("private-provider private-password"), { code: "EAUTH" });
    assert.equal((await send({ email: recipient, link })).reason, "configuration");
    fixture.error = Object.assign(new Error("private-provider private-token"), { code: "ETIMEDOUT" });
    assert.equal((await send({ email: recipient, link })).reason, "delivery");
    assert.equal(fixture.options.length, 5, "no provider fallback or automatic retries");
    assert.equal(fixture.closed, 5);
    assert.doesNotMatch(JSON.stringify(logs), sensitive);
  });
});
