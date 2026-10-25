import { randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const MAX_EMAIL_BODY_BYTES = 128 * 1024;
export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_ATTACHMENT_REQUEST_BYTES = 26 * 1024 * 1024;
export const EMAIL_RELAY_DEADLINE_MS = 14_000;
export const ATTACHMENT_RELAY_DEADLINE_MS = 55_000;

type Reason = "configuration" | "rate_limit" | "delivery";
type ParsedAddress = { address?: string; group?: unknown };
type Env = (name: string) => string | undefined;

export type RelayMail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  messageId: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  disableFileAccess: true;
  disableUrlAccess: true;
};

export type RelaySmtpOptions = {
  host: string;
  port: 465;
  secure: true;
  pool: false;
  auth: { user: string; pass: string };
  tls: { servername: string; rejectUnauthorized: true; minVersion: "TLSv1.2" };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  dnsTimeout: number;
  logger: false;
  debug: false;
  disableFileAccess: true;
  disableUrlAccess: true;
};

export type RelayTransport = {
  sendMail: (mail: RelayMail) => Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  /** Must abort the active socket, not merely close an idle connection pool. */
  close: () => void;
};

type Dependencies = {
  env: Env;
  parseAddress: (value: string) => ParsedAddress[];
  createTransport: (options: RelaySmtpOptions) => RelayTransport;
  /** Test seam only; deployment uses the fixed bounded maximum. */
  deadlineMs?: number;
};

class RelayFailure extends Error {
  constructor(readonly status: number, readonly reason: Reason) {
    super("Email relay request failed");
  }
}

const response = (status: number, body: object) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const failure = (status: number, reason: Reason, disposition?: "retry" | "failed" | "uncertain") => response(status, { ok: false, reason, ...(disposition ? { disposition } : {}) });
const secretPattern = /^[a-f\d]{64}$/i;
const controls = /[\u0000-\u001f\u007f]/;

function authorized(request: Request, secret: string) {
  const token = /^Bearer ([a-f\d]{64})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return false;
  // Both byte arrays have a fixed public length. No JWT/API key is accepted.
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  return timingSafeEqual(bytes(token), bytes(secret));
}

function mailbox(value: unknown, parse: Dependencies["parseAddress"]): string | null {
  if (typeof value !== "string" || !value.length || value.length > 320 || controls.test(value)) return null;
  const address = value.trim();
  // A bare mailbox only: no lists, groups, names, comments or quoted headers.
  const parsed = parse(address);
  if (parsed.length !== 1 || parsed[0].group || parsed[0].address !== address) return null;
  const parts = address.split("@");
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1].includes(".")) return null;
  if (!/^[a-z\d.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0]) || /^\.|\.\.|\.$/.test(parts[0])) return null;
  if (parts[1].length > 253 || !parts[1].split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null;
  return address;
}

function smtpConfiguration(env: Env, parse: Dependencies["parseAddress"]) {
  const host = (env("SMTP_HOST") ?? "smtp.daum.net").trim().toLowerCase();
  const port = (env("SMTP_PORT") ?? "465").trim();
  const from = env("SMTP_FROM")?.trim();
  // Display names are permitted only in server-owned configuration. The SMTP
  // envelope still belongs to the single parsed, authenticated mailbox.
  const sender = from && from.length <= 998 && !controls.test(from) ? parse(from) : [];
  const fromAddress = sender.length === 1 && !sender[0].group ? mailbox(sender[0].address, parse) : null;
  const rawUser = env("SMTP_USER");
  const user = rawUser && rawUser.length <= 320 && !controls.test(rawUser) ? rawUser.trim() : null;
  const pass = env("SMTP_PASS");
  // Daum's account settings can specify a bare login ID. It must still own the
  // fixed sender: accept only that mailbox or its exact local part.
  if (!["smtp.daum.net", "smtp.hanmail.net"].includes(host) || port !== "465" || !from || !fromAddress || !user ||
      !/@(?:daum|hanmail)\.net$/i.test(fromAddress) ||
      (user.toLowerCase() !== fromAddress.toLowerCase() && user.toLowerCase() !== fromAddress.split("@")[0].toLowerCase()) ||
      !pass || !pass.trim() || controls.test(pass) || pass.length > 1024) {
    throw new RelayFailure(503, "configuration");
  }
  const options: RelaySmtpOptions = {
    host, port: 465, secure: true, pool: false, auth: { user, pass },
    tls: { servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10_000, greetingTimeout: 5_000, socketTimeout: 10_000, dnsTimeout: 5_000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
  return { from, senderDomain: fromAddress.split("@")[1], options };
}

async function readPayload(request: Request, signal: AbortSignal): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new RelayFailure(415, "configuration");
  const length = request.headers.get("content-length");
  const maximum = request.headers.get("x-onside-attachment-count") === "3" ? MAX_ATTACHMENT_REQUEST_BYTES : MAX_EMAIL_BODY_BYTES;
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    throw new RelayFailure(413, "configuration");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RelayFailure(400, "configuration");
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        cancel();
        throw new RelayFailure(413, "configuration");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { throw new RelayFailure(400, "configuration"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function validatedMessage(payload: unknown, from: string, messageId: string, parse: Dependencies["parseAddress"]): RelayMail {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new RelayFailure(400, "configuration");
  const input = payload as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["to", "subject", "html", "replyTo", "requestId", "attachments"].includes(key))) throw new RelayFailure(400, "configuration");
  if (input.requestId !== undefined && (typeof input.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.requestId))) throw new RelayFailure(400, "configuration");
  const to = mailbox(input.to, parse);
  const replyTo = input.replyTo === undefined ? undefined : mailbox(input.replyTo, parse);
  if (!to || replyTo === null || typeof input.subject !== "string" || !input.subject.trim() ||
      input.subject.length > 998 || controls.test(input.subject) || typeof input.html !== "string" || !input.html.trim() || Buffer.byteLength(input.html) > MAX_EMAIL_BODY_BYTES) {
    throw new RelayFailure(400, "configuration");
  }
  let attachments: RelayMail["attachments"];
  if (input.attachments !== undefined) {
    if (!Array.isArray(input.attachments) || input.attachments.length !== 3) throw new RelayFailure(400, "configuration");
    let total = 0;
    attachments = input.attachments.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["filename", "contentType", "contentBase64"].includes(key))) throw new RelayFailure(400, "configuration");
      const item = value as Record<string, unknown>;
      if (typeof item.filename !== "string" || !item.filename || item.filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(item.filename) ||
        typeof item.contentType !== "string" || !["application/pdf", "image/png", "image/jpeg"].includes(item.contentType) ||
        typeof item.contentBase64 !== "string" || !item.contentBase64 || item.contentBase64.length % 4 !== 0 || item.contentBase64.length > MAX_EMAIL_ATTACHMENT_BYTES * 4 / 3 + 4 || /[^A-Za-z0-9+/=]/.test(item.contentBase64)) throw new RelayFailure(400, "configuration");
      const content = Buffer.from(item.contentBase64, "base64"); total += content.length;
      if (!content.length || total > MAX_EMAIL_ATTACHMENT_BYTES || content.toString("base64") !== item.contentBase64) throw new RelayFailure(413, "configuration");
      const detected = content.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf" : content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : content.length >= 3 && content[0] === 255 && content[1] === 216 && content[2] === 255 ? "image/jpeg" : null;
      if (detected !== item.contentType) throw new RelayFailure(400, "configuration");
      return { filename: item.filename, contentType: item.contentType, content };
    });
  }
  return { from, to, subject: input.subject, html: input.html, messageId,
    ...(replyTo ? { replyTo } : {}), ...(attachments ? { attachments } : {}), disableFileAccess: true, disableUrlAccess: true };
}

export function createEmailRelayHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let secret: string | undefined;
    try { secret = dependencies.env("EMAIL_RELAY_SECRET"); } catch { return failure(503, "configuration"); }
    if (!secret || !secretPattern.test(secret)) return failure(503, "configuration");
    if (!authorized(request, secret)) return failure(401, "configuration");
    if (request.method !== "POST") return failure(405, "configuration");
    const maximumDeadline = request.headers.get("x-onside-attachment-count") === "3" ? ATTACHMENT_RELAY_DEADLINE_MS : EMAIL_RELAY_DEADLINE_MS;
    const deadlineMs = Math.min(Math.max(dependencies.deadlineMs ?? maximumDeadline, 1), maximumDeadline);

    const controller = new AbortController();
    let transport: RelayTransport | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { try { transport?.close(); } catch { /* No provider details escape. */ } };
    const abort = () => { controller.abort(); close(); };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { abort(); reject(new RelayFailure(504, "delivery")); }, deadlineMs);
      });
      const work = async () => {
        controller.signal.throwIfAborted();
        const { from, senderDomain, options } = smtpConfiguration(dependencies.env, dependencies.parseAddress);
        const payload = await readPayload(request, controller.signal);
        const suppliedId = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).requestId : undefined;
        const id = typeof suppliedId === "string" ? suppliedId : randomUUID();
        const mail = validatedMessage(payload, from, `<${id}@${senderDomain}>`, dependencies.parseAddress);
        controller.signal.throwIfAborted();
        transport = dependencies.createTransport(options);
        const info = await transport.sendMail(mail);
        controller.signal.throwIfAborted();
        if (info.rejected?.length || !info.accepted?.some((address) => typeof address === "string" && address.toLowerCase() === mail.to.toLowerCase())) {
          throw new RelayFailure(502, "delivery");
        }
        return response(200, { ok: true, messageId: `smtp-${id}` });
      };
      return await Promise.race([work(), deadline]);
    } catch (error) {
      if (error instanceof RelayFailure) return failure(error.status, error.reason);
      if (controller.signal.aborted) return failure(504, "delivery");
      const smtp = error && typeof error === "object" ? error as { code?: string; responseCode?: number; command?: string } : {};
      if (smtp.code === "EAUTH") return failure(503, "configuration");
      if (smtp.responseCode && smtp.responseCode >= 400 && smtp.responseCode < 500) return failure(429, "rate_limit", "retry");
      if (smtp.responseCode && smtp.responseCode >= 500) return failure(502, "delivery", "failed");
      if (smtp.command === "CONN" || smtp.code === "EDNS") return failure(502, "delivery", "retry");
      return failure(502, "delivery", "uncertain");
    } finally {
      if (timer) clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      close();
    }
  };
}
