import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { getBaseUrl } from "@/lib/url";

/**
 * Did the customer see a result? Two administrator-only signals:
 * - email opens, from a 1×1 image in customer mail (an indication: image
 *   blocking hides opens and some mail apps prefetch images);
 * - result page views and result file downloads by the customer.
 * Recording never blocks or fails the customer's request.
 */

/** Customer mail about one application (same list as the admin mail history). */
export const OPEN_TRACKED_EMAIL_OPERATIONS: ReadonlySet<string> = new Set([
  "submission receipt", "bank payment request", "payment completed",
  "submission update", "review result", "guest lookup",
]);

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

/** The mail body with the open-tracking image, for customer mail about an application. */
export function withEmailOpenPixel(mail: TrackableMail, options: { baseUrl?: string; key?: Buffer | null } = {}) {
  if (!mail.submission_id || !OPEN_TRACKED_EMAIL_OPERATIONS.has(mail.operation)) return mail.html;
  const token = emailOpenToken(mail.id, options.key === undefined ? defaultSigningKey() : options.key);
  if (!token) return mail.html;
  const base = (options.baseUrl ?? getBaseUrl()).replace(/\/+$/, "");
  const pixel = `<img src="${base}/api/email/open/${mail.id.toLowerCase()}/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0;opacity:0" />`;
  return /<\/body>/i.test(mail.html) ? mail.html.replace(/<\/body>/i, `${pixel}</body>`) : `${mail.html}${pixel}`;
}

export async function recordEmailOpen(outboxId: string) {
  try {
    await createAdminClient().rpc("record_email_open", { p_id: outboxId });
  } catch {
    // An open that cannot be stored is simply not reported.
  }
}

/** Call only after the request was authorized as the customer (member owner
 * or guest code holder), never for an administrator's preview. */
export async function recordCustomerResultView(submissionId: string, options: { download?: boolean } = {}) {
  if (!uuid.test(submissionId)) return;
  try {
    await createAdminClient().rpc("record_submission_customer_view", {
      p_submission_id: submissionId,
      p_download: Boolean(options.download),
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

export function recordEmailOpenAfterResponse(outboxId: string) {
  later(() => recordEmailOpen(outboxId));
}

export function recordCustomerResultViewAfterResponse(submissionId: string, options: { download?: boolean } = {}) {
  later(() => recordCustomerResultView(submissionId, options));
}

/** A transparent 1×1 GIF. */
export const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
