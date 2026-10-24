import { randomUUID } from "node:crypto";
import { createTransport } from "nodemailer";
import { APP_CONFIG } from "@/lib/config";
import { classifyEmailProviderFailure, getEmailDeliveryConfiguration, isEmailRecipient } from "@/lib/email-config";

export type EmailSendResult = {
  /** The provider accepted the request; this does not assert inbox delivery. */
  ok: boolean;
  skipped?: boolean;
  message?: string;
  reason?: "configuration" | "rate_limit" | "delivery";
  retryAfterSeconds?: number;
  messageId?: string;
};

type Message = { to: string; subject: string; html: string; operation: string; idempotencyKey?: string; includeMessageId?: boolean };
const TIMEOUT_MS = 10_000;
const RELAY_TIMEOUT_MS = 25_000;
const failure = (reason: EmailSendResult["reason"] = "delivery", skipped = false): EmailSendResult => ({
  ok: false, skipped, reason, message: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
});
const safeMessageId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;

async function httpFailure(response: Response, operation: string, provider: "resend" | "gmail"): Promise<EmailSendResult> {
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
  return {
    ...failure(reason),
    ...(reason === "rate_limit" ? { retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3600, Math.ceil(retryAfter)) : 60 } : {}),
  };
}

/** A single attempt via the explicitly selected provider. Never retry uncertain sends. */
export async function sendTransactionalEmail(message: Message): Promise<EmailSendResult> {
  const config = getEmailDeliveryConfiguration({ supportEmail: APP_CONFIG.supportEmail });
  if (config.mode === "manual") return {
    ok: false, skipped: true, reason: "configuration",
    message: "현재 이메일 자동 발송을 제공하지 않습니다. 신청 내역에서 진행 상황과 결과를 확인해주세요.",
  };
  if (!config.ok || !isEmailRecipient(message.to) || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(message.subject)) {
    return failure("configuration", true);
  }
  const mail = { from: config.from, to: message.to, subject: message.subject, html: message.html, ...(config.replyTo ? { replyTo: config.replyTo } : {}) };
  try {
    if (config.provider === "supabase-smtp" && config.relay) {
      const response = await fetch(config.relay.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${config.relay.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: message.to, subject: message.subject, html: message.html, ...(config.replyTo ? { replyTo: config.replyTo } : {}) }),
      });
      const result = await response.json().catch(() => null);
      // A successful HTTP response alone does not establish SMTP acceptance.
      // Only the relay's fixed acknowledgement and generated UUID are valid.
      if (
        response.ok && result?.ok === true && typeof result.messageId === "string" &&
        /^smtp-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(result.messageId)
      ) return { ok: true, ...(message.includeMessageId ? { messageId: result.messageId } : {}) };

      const reason = result?.ok === false && ["configuration", "rate_limit", "delivery"].includes(result.reason)
        ? result.reason as NonNullable<EmailSendResult["reason"]>
        : response.ok ? "delivery" : classifyEmailProviderFailure(response.status).reason;
      console.error(`[Email] ${message.operation} relay rejected`, { status: response.status, reason });
      return { ...failure(reason), ...(reason === "rate_limit" ? { retryAfterSeconds: 60 } : {}) };
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
      const id = randomUUID();
      try {
        const result = await transport.sendMail({ ...mail, messageId: `<${id}@${config.sender.senderDomain}>` });
        if (!result.accepted?.length || result.rejected?.length) return failure();
        // SMTP has no provider idempotency API. This ID correlates the MIME message only.
        return { ok: true, ...(message.includeMessageId ? { messageId: `smtp-${id}` } : {}) };
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
      if (!tokenResponse.ok) return httpFailure(tokenResponse, message.operation, "gmail");
      const token = await tokenResponse.json().catch(() => null);
      if (typeof token?.access_token !== "string" || !token.access_token || /\s/.test(token.access_token)) return failure("configuration");
      // Stream transport only builds MIME in memory; it never opens an SMTP connection.
      const builder = createTransport({ streamTransport: true, buffer: true, newline: "windows", disableFileAccess: true, disableUrlAccess: true });
      const mime = await builder.sendMail(mail);
      if (!Buffer.isBuffer(mime.message)) return failure("configuration");
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: mime.message.toString("base64url") }),
      });
      if (!response.ok) return httpFailure(response, message.operation, "gmail");
      const accepted = await response.json().catch(() => null);
      const messageId = safeMessageId(accepted?.id);
      return { ok: true, ...(message.includeMessageId && messageId ? { messageId } : {}) };
    }

    if (config.provider !== "resend") return failure("configuration", true);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}) },
      body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, html: message.html, ...(config.replyTo ? { reply_to: config.replyTo } : {}) }),
    });
    if (!response.ok) return httpFailure(response, message.operation, "resend");
    const accepted = await response.json().catch(() => null);
    const messageId = safeMessageId(accepted?.id);
    return { ok: true, ...(message.includeMessageId && messageId ? { messageId } : {}) };
  } catch (error) {
    // SMTP errors can include entire server replies. Keep only a fixed category.
    const reason = error && typeof error === "object" && "code" in error && error.code === "EAUTH" ? "configuration" : "delivery";
    console.error(`[Email] ${message.operation} failed`, { reason });
    return failure(reason);
  }
}
