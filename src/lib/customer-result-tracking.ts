import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";

import { OPEN_TRACKED_EMAIL_OPERATIONS } from "@/lib/email-tracking-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { getBaseUrl } from "@/lib/url";

/**
 * Did the customer see a result? Administrator-only signals:
 * - email opens, from a 1×1 image in customer mail (an indication: image
 *   blocking hides opens and some mail apps prefetch images);
 * - clicks on Onside links in customer mail, through a signed redirect;
 * - result page views and result file downloads by the customer.
 * Each signal also keeps a coarse client category (never the IP address or
 * the raw user agent). Recording never blocks or fails the customer's request.
 */

export { EMAIL_OPEN_TRACKING_SINCE, OPEN_TRACKED_EMAIL_OPERATIONS } from "@/lib/email-tracking-shared";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultSigningKey(): Buffer | null {
  try {
    return createHmac("sha256", getServiceRoleKey()).update("onside-email-open-v1").digest();
  } catch {
    return null;
  }
}

export function emailOpenToken(outboxId: string, key: Buffer | null = defaultSigningKey()) {
  if (!key || !uuid.test(outboxId)) return null;
  return createHmac("sha256", key).update(outboxId.toLowerCase()).digest("hex").slice(0, 32);
}

export function isValidEmailOpenToken(outboxId: string, token: string, key: Buffer | null = defaultSigningKey()) {
  const expected = emailOpenToken(outboxId, key);
  if (!expected || !/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

type TrackableMail = { id: string; operation: string; submission_id?: string | null; html: string };

/** What a delivered mail carries; stored on the outbox row (email_outbox.tracking). */
export type EmailTracking = "open" | "open+click";

const decodeAttribute = (value: string) => value
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const encodeAttribute = (value: string) => value
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page a tracked link opens: a path on the Onside site, never elsewhere. */
export function safeTrackedTarget(to: string | null | undefined, baseUrl: string = getBaseUrl()) {
  const base = new URL(baseUrl);
  const home = `${base.origin}/`;
  if (!to || !to.startsWith("/") || to.startsWith("//") || /[\\\u0000-\u001f]/.test(to)) return home;
  try {
    const url = new URL(to, base.origin);
    return url.origin === base.origin ? url.toString() : home;
  } catch {
    return home;
  }
}

/** The customer mail body as delivered: Onside links go through the signed
 * click redirect and the open image is added before </body>. Other mail, and
 * mail without an application, is returned unchanged. */
export function withCustomerEmailTracking(
  mail: TrackableMail,
  options: { baseUrl?: string; key?: Buffer | null } = {},
): { html: string; tracking: EmailTracking | null } {
  if (!mail.submission_id || !OPEN_TRACKED_EMAIL_OPERATIONS.has(mail.operation)) return { html: mail.html, tracking: null };
  const token = emailOpenToken(mail.id, options.key === undefined ? defaultSigningKey() : options.key);
  if (!token) return { html: mail.html, tracking: null };
  const origin = new URL(options.baseUrl ?? getBaseUrl()).origin;
  const id = mail.id.toLowerCase();
  let links = 0;
  const linked = mail.html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (match, before: string, raw: string, after: string) => {
    let url: URL;
    try { url = new URL(decodeAttribute(raw)); } catch { return match; }
    if (url.origin !== origin) return match;
    links += 1;
    const target = `${url.pathname}${url.search}${url.hash}`;
    return `${before}${encodeAttribute(`${origin}/api/email/click/${id}/${token}?to=${encodeURIComponent(target)}`)}${after}`;
  });
  const pixel = `<img src="${origin}/api/email/open/${id}/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0;opacity:0" />`;
  const html = /<\/body>/i.test(linked) ? linked.replace(/<\/body>/i, `${pixel}</body>`) : `${linked}${pixel}`;
  return { html, tracking: links ? "open+click" : "open" };
}

/** The mail body with the open-tracking image (and tracked links). */
export function withEmailOpenPixel(mail: TrackableMail, options: { baseUrl?: string; key?: Buffer | null } = {}) {
  return withCustomerEmailTracking(mail, options).html;
}

/** Coarse category of the program that made a request, for administrators. */
export type ActivityClient =
  | "gmail" | "yahoo" | "outlook" | "naver" | "kakao" | "mail_proxy" | "apple_app"
  | "mobile" | "pc" | "automated" | "unknown";

export function classifyActivityClient(userAgent: string | null | undefined): ActivityClient {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "unknown";
  if (/GoogleImageProxy|ggpht\.com/i.test(ua)) return "gmail";
  if (/YahooMailProxy/i.test(ua)) return "yahoo";
  if (/Microsoft Outlook|MSOffice|ms-office|Outlook-(?:iOS|Android)/i.test(ua)) return "outlook";
  if (/\b(?:bot|crawler|spider|scanner)\b|curl\/|wget|python-|go-http-client|okhttp|node-fetch|undici|axios|java\/|libwww|headlesschrome|barracuda|proofpoint|mimecast/i.test(ua)) return "automated";
  if (/NAVER\(inapp|NaverMail|\bNAVER\b/i.test(ua)) return "naver";
  if (/KAKAOTALK|DaumApps|DaumMail/i.test(ua)) return "kakao";
  // Apple Mail Privacy Protection and similar proxies send a bare agent.
  if (/^Mozilla\/5\.0$/i.test(ua)) return "mail_proxy";
  if (/AppleWebKit/i.test(ua) && !/Safari|Chrome|CriOS|FxiOS|EdgiOS|Version\//i.test(ua)) return "apple_app";
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return "mobile";
  if (/Macintosh|Windows|Linux|CrOS|X11/i.test(ua)) return "pc";
  return "unknown";
}

export type EmailActivityKind = "mail_open" | "mail_click";

export async function recordEmailActivity(outboxId: string, kind: EmailActivityKind, client: ActivityClient = "unknown") {
  if (!uuid.test(outboxId)) return;
  try {
    await createAdminClient().rpc("record_email_activity", { p_id: outboxId.toLowerCase(), p_kind: kind, p_client: client });
  } catch {
    // An open or click that cannot be stored is simply not reported.
  }
}

/** Result files a customer can download, as recorded. */
export type CustomerDownloadFile = "mv-certificate" | "mv-guide" | "mv-rating-image";

/** Call only after the request was authorized as the customer (member owner
 * or guest code holder), never for an administrator's preview. */
export async function recordCustomerResultView(submissionId: string, options: {
  download?: CustomerDownloadFile; via?: "member" | "guest"; client?: ActivityClient;
} = {}) {
  if (!uuid.test(submissionId)) return;
  try {
    await createAdminClient().rpc("record_customer_activity", {
      p_submission_id: submissionId,
      p_kind: options.download ? "download" : "page_view",
      p_detail: options.download ?? options.via ?? null,
      p_client: options.client ?? "unknown",
    });
  } catch {
    // Viewing the result must never fail because the record could not be written.
  }
}

/** Records after the response is sent; outside a request (tests, scripts) it runs directly. */
function later(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

export function recordEmailActivityAfterResponse(outboxId: string, kind: EmailActivityKind, client?: ActivityClient) {
  later(() => recordEmailActivity(outboxId, kind, client));
}

export function recordCustomerResultViewAfterResponse(
  submissionId: string,
  options: Parameters<typeof recordCustomerResultView>[1] = {},
) {
  later(() => recordCustomerResultView(submissionId, options));
}

/** A transparent 1×1 GIF. */
export const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
