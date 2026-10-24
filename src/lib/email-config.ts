import { getEmailDeliveryMode } from "./email-delivery-mode";

export type EmailProvider = "resend" | "smtp" | "gmail" | "supabase-smtp";

export type EmailSenderConfiguration =
  | { ok: true; from: string; replyTo?: string; senderDomain: string }
  | {
      ok: false;
      reason: "missing_sender" | "invalid_sender" | "unsupported_sender_domain";
      diagnostic: string;
    };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// These mailbox providers own their domains. An inbox customer cannot verify
// their DNS records as a Resend sender. Custom domains hosted by these services
// remain valid here; actual DNS verification belongs to Resend.
const UNSUPPORTED_SENDER_DOMAINS = new Set([
  "daum.net", "hanmail.net", "gmail.com", "googlemail.com", "naver.com",
  "kakao.com", "nate.com", "empal.com", "hotmail.com", "hotmail.co.kr",
  "outlook.com", "outlook.kr", "live.com", "live.co.kr", "msn.com",
  "icloud.com", "me.com", "mac.com", "yahoo.com", "yahoo.co.kr",
  "yahoo.co.jp", "yahoo.co.uk", "ymail.com", "rocketmail.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "mail.com", "gmx.com", "gmx.net",
  // Resend's test sender only delivers to restricted test recipients.
  "resend.dev",
]);

const parseMailbox = (value: string) => {
  if (value.length > 254 || CONTROL_CHARACTERS.test(value)) return null;
  const parts = value.split("@");
  if (parts.length !== 2) return null;
  const [local, rawDomain] = parts;
  if (
    !local || local.length > 64 || !LOCAL_PART.test(local) ||
    local.startsWith(".") || local.endsWith(".") || local.includes("..")
  ) return null;
  const domain = rawDomain.toLowerCase();
  const labels = domain.split(".");
  if (
    labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label)) ||
    !/^[a-z]{2,63}$/.test(labels.at(-1) ?? "")
  ) return null;
  return { address: `${local}@${domain}`, domain };
};

const parseSender = (value: string) => {
  // Check before trimming: a trailing newline is still header injection.
  if (value.length > 512 || CONTROL_CHARACTERS.test(value)) return null;
  const raw = value.trim();
  const direct = parseMailbox(raw);
  if (direct) return { from: direct.address, domain: direct.domain };

  const match = /^([^<>]+)<([^<>]+)>$/.exec(raw);
  if (!match) return null;
  const displayName = match[1].trim();
  const mailbox = parseMailbox(match[2].trim());
  if (!displayName || !mailbox || /[;\\]/.test(displayName)) return null;
  if (displayName.startsWith('"') && displayName.endsWith('"')) {
    const quotedName = displayName.slice(1, -1);
    if (!quotedName.trim() || quotedName.includes('"')) return null;
  } else if (/[",()[\]:@]/.test(displayName)) {
    return null;
  }
  return { from: `${displayName} <${mailbox.address}>`, domain: mailbox.domain };
};

/**
 * Validates a single explicit sender, without assuming its DNS is verified.
 * A support inbox is only a reply destination, never a fallback sender.
 * Failure diagnostics are fixed strings and never contain environment values.
 */
export function getEmailSenderConfiguration({ from, supportEmail, provider = "resend" }: {
  from?: string | null;
  supportEmail?: string | null;
  provider?: EmailProvider;
}): EmailSenderConfiguration {
  const senderVariable = provider === "resend" ? "RESEND_FROM" : provider === "gmail" ? "GMAIL_FROM" : "SMTP_FROM";
  if (from == null || from === "" || (!CONTROL_CHARACTERS.test(from) && !from.trim())) {
    return {
      ok: false,
      reason: "missing_sender",
      diagnostic: provider === "resend" ? "RESEND_FROM is required; configure a verified sender domain." : `${senderVariable} is required; configure your authenticated mailbox sender.`,
    };
  }
  const sender = parseSender(from);
  if (!sender) {
    return {
      ok: false,
      reason: "invalid_sender",
      diagnostic: `${senderVariable} must contain one valid sender address without control characters.`,
    };
  }
  if (provider === "resend" && [...UNSUPPORTED_SENDER_DOMAINS].some((domain) =>
    sender.domain === domain || sender.domain.endsWith(`.${domain}`))) {
    return {
      ok: false,
      reason: "unsupported_sender_domain",
      diagnostic: "RESEND_FROM must use your own verified domain, not a public mailbox or test sender domain.",
    };
  }

  const replyTo = supportEmail && !CONTROL_CHARACTERS.test(supportEmail)
    ? parseMailbox(supportEmail.trim())?.address
    : undefined;
  return {
    ok: true,
    from: sender.from,
    ...(replyTo ? { replyTo } : {}),
    senderDomain: sender.domain,
  };
}

export type SmtpConfiguration = {
  host: string;
  port: 465 | 587;
  secure: boolean;
  user: string;
  pass: string;
};

/** Only a single recipient mailbox is allowed, never address-list syntax. */
export function isEmailRecipient(value: string): boolean {
  return Boolean(parseMailbox(value));
}

function getSmtpConfiguration(): { ok: true; config: SmtpConfiguration } | { ok: false; diagnostic: string } {
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const port = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim() ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  if (!host || host.length > 253 || !host.split(".").every(label => DOMAIN_LABEL.test(label))) {
    return { ok: false, diagnostic: "SMTP_HOST must be a valid hostname." };
  }
  if (port !== "465" && port !== "587") {
    return { ok: false, diagnostic: "SMTP_PORT must be 465 (TLS) or 587 (required STARTTLS)." };
  }
  if (!user || CONTROL_CHARACTERS.test(user) || !pass.trim() || CONTROL_CHARACTERS.test(pass)) {
    return { ok: false, diagnostic: "SMTP_USER and SMTP_PASS are required without control characters." };
  }
  return { ok: true, config: { host, port: port === "465" ? 465 : 587, secure: port === "465", user, pass } };
}

export type GmailConfiguration = { clientId: string; clientSecret: string; refreshToken: string };

export type SupabaseEmailRelayConfiguration = { url: string; secret: string };

function getSupabaseEmailRelayConfiguration(): { ok: true; config: SupabaseEmailRelayConfiguration } | { ok: false; diagnostic: string } {
  // Match the server's Supabase client: an explicit server URL wins over the
  // public build value, so a stale public URL cannot receive relay credentials.
  const serverUrl = process.env.SUPABASE_URL;
  const projectUrl = serverUrl?.trim() ? serverUrl : process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const relayUrl = process.env.SUPABASE_EMAIL_RELAY_URL ?? "";
  const secret = process.env.EMAIL_RELAY_SECRET ?? "";
  try {
    const project = new URL(projectUrl);
    // A relay must belong to this configured hosted project. Never send the
    // dedicated secret or message contents to an arbitrary configurable URL.
    if (
      CONTROL_CHARACTERS.test(projectUrl) || projectUrl !== projectUrl.trim() ||
      project.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname) ||
      project.port || project.username || project.password || project.pathname !== "/" ||
      project.search || project.hash || /[?#]/.test(projectUrl) ||
      relayUrl !== `${project.origin}/functions/v1/send-transactional-email`
    ) throw new Error("Invalid relay URL");
  } catch {
    return { ok: false, diagnostic: "SUPABASE_EMAIL_RELAY_URL must be the current Supabase project's HTTPS send-transactional-email function URL." };
  }
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) {
    return { ok: false, diagnostic: "EMAIL_RELAY_SECRET must contain exactly 64 hexadecimal characters." };
  }
  return { ok: true, config: { url: relayUrl, secret } };
}

function getGmailConfiguration(): { ok: true; config: GmailConfiguration } | { ok: false; diagnostic: string } {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim() ?? "";
  if ([clientId, clientSecret, refreshToken].some(value => !value || CONTROL_CHARACTERS.test(value))) {
    return { ok: false, diagnostic: "GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN are required." };
  }
  return { ok: true, config: { clientId, clientSecret, refreshToken } };
}

/** The sender and readiness probe agree on the selected transport. Never fall back. */
export function getEmailDeliveryConfiguration({
  apiKey = process.env.RESEND_API_KEY,
  from,
  supportEmail,
  provider = process.env.EMAIL_PROVIDER ?? "resend",
}: { apiKey?: string; from?: string; supportEmail?: string | null; provider?: string } = {}) {
  const selectedProvider = provider.trim();
  const providerValid = selectedProvider === "resend" || selectedProvider === "smtp" || selectedProvider === "gmail" || selectedProvider === "supabase-smtp";
  const sender = getEmailSenderConfiguration({
    from: from ?? (selectedProvider === "smtp" || selectedProvider === "supabase-smtp" ? process.env.SMTP_FROM : selectedProvider === "gmail" ? process.env.GMAIL_FROM : process.env.RESEND_FROM),
    supportEmail,
    provider: providerValid ? selectedProvider : "resend",
  });
  const normalizedKey = apiKey?.trim() || "";
  const mode = getEmailDeliveryMode();
  const enabled = mode === "transactional";
  const smtp = selectedProvider === "smtp" ? getSmtpConfiguration() : undefined;
  const gmail = selectedProvider === "gmail" ? getGmailConfiguration() : undefined;
  const relay = selectedProvider === "supabase-smtp" ? getSupabaseEmailRelayConfiguration() : undefined;
  const transportReady = selectedProvider === "smtp" ? smtp?.ok === true : selectedProvider === "gmail" ? gmail?.ok === true : selectedProvider === "supabase-smtp" ? relay?.ok === true : Boolean(normalizedKey);
  return {
    mode,
    provider: providerValid ? selectedProvider : "invalid",
    ok: enabled && providerValid && transportReady && sender.ok,
    apiKey: enabled && selectedProvider === "resend" ? normalizedKey : "",
    smtp: enabled && smtp?.ok ? smtp.config : undefined,
    gmail: enabled && gmail?.ok ? gmail.config : undefined,
    relay: enabled && relay?.ok ? relay.config : undefined,
    from: enabled && sender.ok ? sender.from : "",
    replyTo: enabled && sender.ok ? sender.replyTo : undefined,
    sender,
    diagnostic: mode === "manual"
      ? "Transactional email delivery is deferred in manual mode."
      : mode === "invalid"
        ? "NEXT_PUBLIC_EMAIL_DELIVERY_MODE must be manual or transactional."
        : !providerValid
          ? "EMAIL_PROVIDER must be resend, smtp, gmail or supabase-smtp."
          : smtp && !smtp.ok
            ? smtp.diagnostic
            : gmail && !gmail.ok
              ? gmail.diagnostic
            : relay && !relay.ok
              ? relay.diagnostic
            : selectedProvider === "resend" && !normalizedKey
              ? "RESEND_API_KEY is required for the Resend email provider."
              : !sender.ok ? sender.diagnostic : undefined,
  };
}

// Keep only documented, fixed provider codes. Provider messages can contain
// recipient addresses, message bodies, or recovery credentials.
// Reference: https://resend.com/docs/api-reference/errors
const PROVIDER_ERROR_NAMES = new Set([
  "invalid_idempotency_key", "validation_error", "missing_api_key",
  "restricted_api_key", "email_above_quota", "invalid_permission",
  "suspended_api_key", "not_found", "method_not_allowed",
  "concurrent_idempotent_requests", "invalid_idempotent_request",
  "resource_locked", "invalid_attachment", "invalid_parameter",
  "missing_required_field", "missing_required_parameter",
  "daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded",
  "application_error", "service_unavailable",
]);

export function classifyEmailProviderFailure(status: number, providerName?: unknown): {
  reason: "configuration" | "rate_limit" | "delivery";
  diagnostic: string;
} {
  const reason = status === 429
    ? "rate_limit"
    : [400, 401, 403, 422].includes(status)
      ? "configuration"
      : "delivery";
  return {
    reason,
    diagnostic: typeof providerName === "string" && PROVIDER_ERROR_NAMES.has(providerName)
      ? `resend_${providerName}`
      : `email_${reason}_error`,
  };
}
