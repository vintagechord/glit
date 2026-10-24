import assert from "node:assert/strict";
import test from "node:test";
import addressparser from "nodemailer/lib/addressparser";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  createEmailRelayHandler, MAX_EMAIL_BODY_BYTES,
  type RelayMail, type RelaySmtpOptions,
} from "../supabase/functions/send-transactional-email/handler";

const secret = "a1".repeat(32);
const baseEnv: Record<string, string> = {
  EMAIL_RELAY_SECRET: secret, SMTP_HOST: "smtp.daum.net", SMTP_PORT: "465",
  SMTP_FROM: "myonside@daum.net", SMTP_USER: "myonside@daum.net", SMTP_PASS: "fixture-app-password",
};
const body = { to: "member@example.invalid", subject: "심의 업데이트 안내", html: "<p>신청 내역을 확인해주세요.</p>" };

function fixture(options: { deadlineMs?: number; result?: { accepted?: unknown[]; rejected?: unknown[] }; error?: unknown; hang?: boolean } = {}) {
  const env = { ...baseEnv };
  const calls: { env: string[]; options: RelaySmtpOptions[]; mail: RelayMail[]; closed: number } = { env: [], options: [], mail: [], closed: 0 };
  const handler = createEmailRelayHandler({
    env: (key) => { calls.env.push(key); return env[key]; }, parseAddress: addressparser,
    deadlineMs: options.deadlineMs,
    createTransport: (smtp) => {
      calls.options.push(smtp);
      return {
        sendMail: async (mail) => {
          calls.mail.push(mail);
          if (options.error) throw options.error;
          if (options.hang) return new Promise(() => {});
          return options.result ?? { accepted: [mail.to], rejected: [] };
        },
        close: () => { calls.closed += 1; },
      };
    },
  });
  return { handler, env, calls };
}

function request(payload: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://project.supabase.co/functions/v1/send-transactional-email", {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

test("relay secret is mandatory and checked before reading a body or touching SMTP credentials", async () => {
  const api = fixture();
  for (const token of ["", "Bearer anon-key", "Bearer eyJhbGciOiJIUzI1NiJ9.user.signature", `Bearer ${"b2".repeat(32)}`]) {
    let bodyRead = false;
    const req = { headers: new Headers({ authorization: token }), method: "POST", get body() { bodyRead = true; throw Error("body must not be read"); } } as unknown as Request;
    const response = await api.handler(req);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, reason: "configuration" });
    assert.equal(bodyRead, false);
  }
  assert.deepEqual(new Set(api.calls.env), new Set(["EMAIL_RELAY_SECRET"]));
  assert.equal(api.calls.options.length, 0);
  api.env.EMAIL_RELAY_SECRET = "weak";
  assert.equal((await api.handler(request())).status, 503);
  assert.equal(api.calls.options.length, 0);
});

test("relay sends exactly one recipient through fixed authenticated Daum TLS and returns an opaque acceptance ID", async () => {
  const api = fixture();
  const response = await api.handler(request({ ...body, replyTo: "support@example.invalid" }));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.ok, true);
  assert.match(json.messageId, /^smtp-[a-f\d-]{36}$/);
  assert.equal(api.calls.mail.length, 1);
  assert.deepEqual(api.calls.mail[0], { ...body, from: "myonside@daum.net", replyTo: "support@example.invalid", messageId: `<${json.messageId.slice(5)}@daum.net>`, disableFileAccess: true, disableUrlAccess: true });
  const smtp = api.calls.options[0];
  assert.equal(smtp.host, "smtp.daum.net"); assert.equal(smtp.port, 465); assert.equal(smtp.secure, true); assert.equal(smtp.pool, false);
  assert.equal(smtp.tls.rejectUnauthorized, true); assert.equal(smtp.tls.minVersion, "TLSv1.2");
  assert.equal(smtp.logger, false); assert.equal(smtp.debug, false);
  assert.equal(api.calls.closed, 1);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(JSON.stringify(json), /member@example|myonside|fixture-app-password/);
});

test("bare Daum login IDs preserve their value while Message-ID uses the validated sender domain", async () => {
  for (const domain of ["daum.net", "hanmail.net"]) {
    const api = fixture();
    api.env.SMTP_USER = " iamonside ";
    api.env.SMTP_FROM = `온사이드 <iamonside@${domain}>`;
    const response = await api.handler(request());
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(api.calls.options[0].auth.user, "iamonside");
    assert.equal(api.calls.mail[0].from, api.env.SMTP_FROM);
    assert.equal(api.calls.mail[0].messageId, `<${json.messageId.slice(5)}@${domain}>`);
    assert.equal(api.calls.mail.length, 1);
    assert.equal(api.calls.closed, 1);
  }
});

test("outbox request IDs correlate the acknowledgement and MIME message while invalid IDs cannot send", async () => {
  const requestId = "12345678-1234-4123-8123-123456789abc";
  const api = fixture();
  const response = await api.handler(request({ ...body, requestId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, messageId: `smtp-${requestId}` });
  assert.equal(api.calls.mail[0].messageId, `<${requestId}@daum.net>`);
  for (const value of ["", "not-a-uuid", "12345678-1234-1123-8123-123456789abc", `${requestId}\r\nBcc: other@example.invalid`]) {
    const invalid = fixture();
    assert.equal((await invalid.handler(request({ ...body, requestId: value }))).status, 400);
    assert.equal(invalid.calls.mail.length, 0);
  }
});

test("arbitrary SMTP hosts, cleartext ports, spoofed senders and invalid credentials fail closed", async () => {
  for (const changes of [
    { SMTP_HOST: "127.0.0.1" }, { SMTP_HOST: "smtp.daum.net.attacker.invalid" },
    { SMTP_PORT: "587" }, { SMTP_PORT: "25" }, { SMTP_FROM: "other@daum.net" },
    { SMTP_FROM: "spoof@example.invalid", SMTP_USER: "spoof@example.invalid" },
    { SMTP_PASS: "" }, { SMTP_USER: "other" }, { SMTP_USER: "myonside@hanmail.net" },
    { SMTP_USER: "myonside\n" }, { SMTP_USER: "myonside\u0000" }, { SMTP_USER: "myonside,other" },
    { SMTP_USER: "온사이드 <myonside@daum.net>" },
    { SMTP_FROM: "spoof@example.invalid", SMTP_USER: "spoof" },
  ]) {
    const api = fixture(); Object.assign(api.env, changes);
    assert.equal((await api.handler(request())).status, 503);
    assert.equal(api.calls.options.length, 0);
  }
  const api = fixture(); api.env.SMTP_HOST = "smtp.hanmail.net";
  api.env.SMTP_USER = api.env.SMTP_FROM = "fixture@hanmail.net";
  assert.equal((await api.handler(request())).status, 200);
  const named = fixture(); named.env.SMTP_FROM = "온사이드 <myonside@daum.net>";
  assert.equal((await named.handler(request())).status, 200);
  assert.equal(named.calls.mail[0].from, named.env.SMTP_FROM);
});

test("mail lists, groups, injected headers and extra message capabilities are rejected before transport creation", async () => {
  const invalid = [
    null, [], {}, { ...body, from: "spoof@daum.net" }, { ...body, cc: "cc@example.invalid" },
    { ...body, bcc: "bcc@example.invalid" }, { ...body, attachments: [] },
    { ...body, headers: { "X-Extra": "x" } }, { ...body, envelope: {} },
    { ...body, to: "a@example.invalid,b@example.invalid" }, { ...body, to: "Group: a@example.invalid;" },
    { ...body, to: "Name <a@example.invalid>" }, { ...body, to: "a@example.invalid\r\nBcc: b@example.invalid" },
    { ...body, to: "a..b@example.invalid" }, { ...body, to: "a@localhost" },
    { ...body, subject: "hello\nBcc: b@example.invalid" }, { ...body, subject: " " },
    { ...body, html: { path: "/etc/passwd" } }, { ...body, html: "" }, { ...body, replyTo: "a@example.invalid,b@example.invalid" },
  ];
  for (const payload of invalid) {
    const api = fixture();
    assert.equal((await api.handler(request(payload))).status, 400, JSON.stringify(payload));
    assert.equal(api.calls.options.length, 0);
  }
});

test("relay rejects non-POST and unsupported content types without CORS or SMTP", async () => {
  const api = fixture();
  for (const method of ["GET", "OPTIONS", "PUT"]) {
    const response = await api.handler(new Request("https://fixture.invalid", { method, headers: { authorization: `Bearer ${secret}` } }));
    assert.equal(response.status, 405); assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  assert.equal((await api.handler(request(body, { "content-type": "text/plain" }))).status, 415);
  assert.equal(api.calls.options.length, 0);
});

test("relay bounds both declared and streamed body sizes in bytes and cancels oversized streams", async () => {
  const api = fixture();
  assert.equal((await api.handler(request(body, { "content-length": String(MAX_EMAIL_BODY_BYTES + 1) }))).status, 413);
  assert.equal((await api.handler(request({ ...body, html: "한".repeat(MAX_EMAIL_BODY_BYTES / 2) }))).status, 413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_EMAIL_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  const req = new Request("https://fixture.invalid", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await api.handler(req)).status, 413);
  assert.equal(cancelled, true); assert.equal(api.calls.options.length, 0);
});

test("SMTP failures expose safe retry dispositions and never retry inside the relay", async () => {
  for (const [error, status, reason, disposition] of [
    [Object.assign(Error("private SMTP response secret@example.invalid"), { code: "EAUTH" }), 503, "configuration", undefined],
    [Object.assign(Error("private SMTP response"), { responseCode: 421 }), 429, "rate_limit", "retry"],
    [Object.assign(Error("private SMTP response"), { responseCode: 550 }), 502, "delivery", "failed"],
    [Object.assign(Error("private SMTP response"), { command: "CONN" }), 502, "delivery", "retry"],
    [Object.assign(Error("private SMTP response"), { code: "ETIMEDOUT", command: "DATA" }), 502, "delivery", "uncertain"],
  ] as const) {
    const api = fixture({ error });
    const response = await api.handler(request());
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, reason, ...(disposition ? { disposition } : {}) });
    assert.equal(api.calls.mail.length, 1); assert.equal(api.calls.closed, 1);
  }
  for (const result of [{ accepted: [] }, { accepted: ["wrong@example.invalid"] }, { accepted: [body.to], rejected: [body.to] }]) {
    const api = fixture({ result });
    assert.equal((await api.handler(request())).status, 502);
    assert.equal(api.calls.mail.length, 1);
  }
});

test("total deadline closes in-flight SMTP and slow request bodies cannot send later", async () => {
  const api = fixture({ deadlineMs: 15, hang: true });
  const response = await api.handler(request());
  assert.equal(response.status, 504); assert.equal(api.calls.mail.length, 1); assert.ok(api.calls.closed >= 1);
  const slow = fixture({ deadlineMs: 15 });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const req = new Request("https://fixture.invalid", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await slow.handler(req)).status, 504);
  assert.equal(cancelled, true); assert.equal(slow.calls.options.length, 0);
});

test("transport cancellation destroys its actual TLS socket and prevents delayed connects or new sends", async () => {
  const bundle = await build({
    stdin: { contents: "export * from './supabase/functions/send-transactional-email/transport.ts';export {state} from 'transport-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "transport-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(nodemailer|node:tls|transport-fixture)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: ({
        "transport-fixture": "export const state={destroyed:0,closed:0,connect:null,socket:null,options:null};",
        "node:tls": "import {state} from 'transport-fixture';import {EventEmitter} from 'node:events';export const connect=(options,callback)=>{state.options=options;state.connect=callback;const socket=new EventEmitter();socket.destroy=()=>{state.destroyed++;socket.emit('close')};state.socket=socket;return socket};",
        "nodemailer": "import {state} from 'transport-fixture';export default {createTransport:options=>({sendMail:()=>new Promise((resolve,reject)=>options.getSocket({},(error)=>error?reject(error):resolve({accepted:['member@example.invalid']}))),close:()=>{state.closed++}})};",
      } as Record<string, string>)[path] }));
    } }],
  });
  const output = { exports: {} as { createCancellableSmtpTransport: (options: RelaySmtpOptions) => { sendMail(mail: RelayMail): Promise<unknown>; close(): void }; state: { destroyed: number; closed: number; connect: () => void; options: Record<string, unknown> } } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  const api = fixture(); await api.handler(request());
  const transport = output.exports.createCancellableSmtpTransport(api.calls.options[0]);
  const pending = transport.sendMail(api.calls.mail[0]);
  transport.close();
  await assert.rejects(pending, /SMTP connection failed/);
  output.exports.state.connect();
  assert.equal(output.exports.state.destroyed, 1); assert.equal(output.exports.state.closed, 1);
  assert.equal(output.exports.state.options.rejectUnauthorized, true);
  await assert.rejects(transport.sendMail(api.calls.mail[0]), /SMTP request closed/);
  transport.close(); assert.equal(output.exports.state.destroyed, 1);
});
