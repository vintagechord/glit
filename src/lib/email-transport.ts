import { randomUUID } from "node:crypto";
import { createTransport } from "nodemailer";
import { APP_CONFIG } from "@/lib/config";
import { classifyEmailProviderFailure, getEmailDeliveryConfiguration, isEmailRecipient, type EmailProvider } from "@/lib/email-config";
import { enqueueAndSendEmail, type EmailOutboxStatus } from "@/lib/email-outbox";
import { EmailAttachmentError, resolveEmailAttachments, validateEmailAttachmentRefs, type EmailAttachmentRef } from "@/lib/email-attachments";

export type EmailSendResult = {
  /** The provider accepted the request; this does not assert inbox delivery. */
  ok: boolean;
  skipped?: boolean;
  message?: string;
  reason?: "configuration" | "rate_limit" | "delivery";
  retryAfterSeconds?: number;
  messageId?: string;
  queued?: boolean;
  outboxId?: string;
  status?: EmailOutboxStatus;
};

export type EmailMessage = { to: string; subject: string; html: string; operation: string; idempotencyKey?: string; includeMessageId?: boolean; expiresAt?: string; requestId?: string; submissionId?: string; markResultNotified?: boolean; attachmentRefs?: EmailAttachmentRef[] };
export type EmailAttemptResult = EmailSendResult & { outcome: "accepted" | "retry" | "uncertain" | "failed"; errorCode?: string };
const TIMEOUT_MS = 10_000;
const RELAY_TIMEOUT_MS = 25_000;
const failure = (reason: EmailSendResult["reason"] = "delivery", skipped = false): EmailSendResult => ({
  ok: false, skipped, reason, message: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
});
const safeMessageId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
const acceptedAttempt = (messageId: string): EmailAttemptResult => ({ ok: true, outcome: "accepted", messageId });
const failedAttempt = (outcome: "retry" | "uncertain" | "failed", reason: NonNullable<EmailSendResult["reason"]>, errorCode: string, retryAfterSeconds?: number): EmailAttemptResult => ({ ...failure(reason), outcome, errorCode, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });

type TestDispatcher = (message: EmailMessage, deliver: () => Promise<EmailSendResult>) => Promise<EmailSendResult>;
let testDispatcher: TestDispatcher | undefined;
/** Explicit provider-test DI only; production always persists before delivery. */
export function setEmailOutboxTestDispatcher(dispatcher?: TestDispatcher) {
  if (process.env.NODE_ENV !== "test") throw new Error("Email test injection requires NODE_ENV=test");
  testDispatcher = dispatcher;
}
function legacyAttempt(result: EmailAttemptResult, includeMessageId?: boolean): EmailSendResult {
  const { outcome: _outcome, errorCode: _errorCode, ...publicResult } = result;
  void _outcome; void _errorCode;
  if (!includeMessageId) delete publicResult.messageId;
  return publicResult;
}

async function httpFailure(response: Response, operation: string, provider: "resend" | "gmail", beforeSend = false): Promise<EmailAttemptResult> {
  const body = await response.json().catch(() => null);
  const gmailQuotaExceeded = provider === "gmail" && response.status === 403 && Array.isArray(body?.error?.errors)
    && body.error.errors.some((error: { reason?: unknown } | null) =>
      typeof error?.reason === "string" && ["dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(error.reason));
  const { reason, diagnostic } = gmailQuotaExceeded
    ? { reason: "rate_limit" as const, diagnostic: "gmail_rate_limit_error" }
    : classifyEmailProviderFailure(response.status, provider === "resend" ? body?.name : undefined);
  // Provider messages may contain addresses, OAuth credentials or recovery URLs.
  console.error(`[Email] ${operation} rejected`, { status: response.status, reason, diagnostic });
  const retryAfter = Number(response.headers.get("retry-after"));
  const outcome = reason === "configuration" ? "failed" : reason === "rate_limit" || provider === "resend" || beforeSend ? "retry" : "uncertain";
  return failedAttempt(outcome, reason, `http_${response.status}`, reason === "rate_limit" ? Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3600, Math.ceil(retryAfter)) : 60 : undefined);
}

/** Every production send enters durable storage before any provider request. */
export async function sendTransactionalEmail(message: EmailMessage): Promise<EmailSendResult> {
  const config = getEmailDeliveryConfiguration({ supportEmail: APP_CONFIG.supportEmail });
  if (config.mode === "manual") return {
    ok: false, skipped: true, reason: "configuration",
    message: "현재 이메일 자동 발송을 제공하지 않습니다. 신청 내역에서 진행 상황과 결과를 확인해주세요.",
  };
  if (config.mode !== "transactional" || config.provider === "invalid" || (message.attachmentRefs && !validateEmailAttachmentRefs(message.attachmentRefs)) || !isEmailRecipient(message.to) || !message.subject.trim() || message.subject.length > 998 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(message.subject) || !message.html.trim() || message.operation.length > 80 ||
      Buffer.byteLength(JSON.stringify({ to: message.to, subject: message.subject, html: message.html, replyTo: config.replyTo, requestId: "00000000-0000-4000-8000-000000000000" }), "utf8") > 128 * 1024) {
    return failure("configuration", true);
  }
  if (process.env.NODE_ENV === "test" && testDispatcher) {
    return testDispatcher(message, async () => legacyAttempt(await sendEmailAttempt(message), message.includeMessageId));
  }
  return enqueueAndSendEmail(message, config.provider as EmailProvider, config.replyTo, sendEmailAttempt);
}

/** One physical attempt; only the outbox decides whether another attempt is safe. */
export async function sendEmailAttempt(message: EmailMessage, expectedProvider?: EmailProvider, replyToOverride?: string | null): Promise<EmailAttemptResult> {
  const config = getEmailDeliveryConfiguration({ supportEmail: APP_CONFIG.supportEmail });
  if (!config.ok || (expectedProvider && config.provider !== expectedProvider)) return failedAttempt("failed", "configuration", "provider_unavailable");
  const replyTo = replyToOverride === undefined ? config.replyTo : replyToOverride;
  let submissionStarted = false;
  try {
    const attachments = message.attachmentRefs?.length ? await resolveEmailAttachments(message.attachmentRefs) : undefined;
    const mail = { from: config.from, to: message.to, subject: message.subject, html: message.html, ...(replyTo ? { replyTo } : {}), ...(attachments ? { attachments } : {}) };
    if (config.provider === "supabase-smtp" && config.relay) {
      submissionStarted = true;
      const response = await fetch(config.relay.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(attachments ? 65_000 : RELAY_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${config.relay.secret}`, "Content-Type": "application/json", ...(attachments ? { "X-Onside-Attachment-Count": "3" } : {}) },
        body: JSON.stringify({ to: message.to, subject: message.subject, html: message.html, ...(replyTo ? { replyTo } : {}), ...(message.requestId ? { requestId: message.requestId } : {}), ...(attachments ? { attachments: attachments.map(a => ({ filename: a.filename, contentType: a.contentType, contentBase64: a.content.toString("base64") })) } : {}) }),
      });
      const result = await response.json().catch(() => null);
      // A successful HTTP response alone does not establish SMTP acceptance.
      // Only the relay's fixed acknowledgement and generated UUID are valid.
      if (
        response.ok && result?.ok === true && typeof result.messageId === "string" &&
        /^smtp-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(result.messageId)
      ) return acceptedAttempt(result.messageId);

      const reason = result?.ok === false && ["configuration", "rate_limit", "delivery"].includes(result.reason)
        ? result.reason as NonNullable<EmailSendResult["reason"]>
        : response.ok ? "delivery" : classifyEmailProviderFailure(response.status).reason;
      console.error(`[Email] ${message.operation} relay rejected`, { status: response.status, reason });
      const outcome = result?.ok === false && ["retry", "failed", "uncertain"].includes(result.disposition)
        ? result.disposition as "retry" | "failed" | "uncertain"
        : reason === "configuration" ? "failed" : reason === "rate_limit" ? "retry" : "uncertain";
      return failedAttempt(outcome, reason, response.ok ? "invalid_provider_ack" : `relay_http_${response.status}`, reason === "rate_limit" ? 60 : undefined);
    }

    if (config.provider === "smtp" && config.smtp && config.sender.ok) {
      const smtp = config.smtp;
      const transport = createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS, dnsTimeout: TIMEOUT_MS,
        tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
        disableFileAccess: true, disableUrlAccess: true,
        logger: false, debug: false,
      });
      const id = message.requestId ?? randomUUID();
      try {
        submissionStarted = true;
        const result = await transport.sendMail({ ...mail, messageId: `<${id}@${config.sender.senderDomain}>` });
        if (!result.accepted?.length || result.rejected?.length) return failedAttempt("failed", "delivery", "smtp_recipient_rejected");
        // SMTP has no provider idempotency API. This ID correlates the MIME message only.
        return acceptedAttempt(`smtp-${id}`);
      } finally {
        transport.close();
      }
    }

    if (config.provider === "gmail" && config.gmail) {
      const gmail = config.gmail;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: gmail.clientId, client_secret: gmail.clientSecret, refresh_token: gmail.refreshToken, grant_type: "refresh_token" }),
      });
      if (!tokenResponse.ok) return httpFailure(tokenResponse, message.operation, "gmail", true);
      const token = await tokenResponse.json().catch(() => null);
      if (typeof token?.access_token !== "string" || !token.access_token || /\s/.test(token.access_token)) return failedAttempt("failed", "configuration", "invalid_oauth_ack");
      // Stream transport only builds MIME in memory; it never opens an SMTP connection.
      const builder = createTransport({ streamTransport: true, buffer: true, newline: "windows", disableFileAccess: true, disableUrlAccess: true });
      const mime = await builder.sendMail(mail);
      if (!Buffer.isBuffer(mime.message)) return failedAttempt("failed", "configuration", "invalid_mime");
      submissionStarted = true;
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", signal: AbortSignal.timeout(attachments ? 60_000 : TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: mime.message.toString("base64url") }),
      });
      if (!response.ok) return httpFailure(response, message.operation, "gmail");
      const accepted = await response.json().catch(() => null);
      const messageId = safeMessageId(accepted?.id);
      return messageId ? acceptedAttempt(messageId) : failedAttempt("uncertain", "delivery", "invalid_provider_ack");
    }

    if (config.provider !== "resend") return failedAttempt("failed", "configuration", "unknown_provider");
    submissionStarted = true;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(attachments ? 60_000 : TIMEOUT_MS),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}) },
      body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, html: message.html, ...(replyTo ? { reply_to: replyTo } : {}), ...(attachments ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })) } : {}) }),
    });
    if (!response.ok) return httpFailure(response, message.operation, "resend");
    const accepted = await response.json().catch(() => null);
    const messageId = safeMessageId(accepted?.id);
    return messageId ? acceptedAttempt(messageId) : failedAttempt("uncertain", "delivery", "invalid_provider_ack");
  } catch (error) {
    if (error instanceof EmailAttachmentError) return failedAttempt(error.code === "attachment_unavailable" ? "retry" : "failed", "delivery", error.code);
    // SMTP errors can include entire server replies. Keep only a fixed category.
    const smtp = error && typeof error === "object" ? error as { code?: string; responseCode?: number; command?: string } : {};
    const reason = smtp.code === "EAUTH" ? "configuration" : "delivery";
    console.error(`[Email] ${message.operation} failed`, { reason });
    if (reason === "configuration") return failedAttempt("failed", reason, "smtp_auth_rejected");
    if (smtp.responseCode && smtp.responseCode >= 400 && smtp.responseCode < 500) return failedAttempt("retry", "rate_limit", "smtp_temporary_rejection", 60);
    if (smtp.responseCode && smtp.responseCode >= 500) return failedAttempt("failed", "delivery", "smtp_permanent_rejection");
    if (!submissionStarted || smtp.command === "CONN" || smtp.code === "EDNS") return failedAttempt("retry", reason, "connection_unavailable");
    // Resend deduplicates retries with the outbox's stable provider key.
    if (config.provider === "resend" && message.idempotencyKey?.startsWith("outbox-")) return failedAttempt("retry", reason, "provider_unreachable");
    return failedAttempt("uncertain", reason, "acceptance_unknown");
  }
}
