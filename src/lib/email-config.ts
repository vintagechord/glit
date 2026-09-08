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
export function getEmailSenderConfiguration({ from, supportEmail }: {
  from?: string | null;
  supportEmail?: string | null;
}): EmailSenderConfiguration {
  if (from == null || from === "" || (!CONTROL_CHARACTERS.test(from) && !from.trim())) {
    return {
      ok: false,
      reason: "missing_sender",
      diagnostic: "RESEND_FROM is required; configure a verified sender domain.",
    };
  }
  const sender = parseSender(from);
  if (!sender) {
    return {
      ok: false,
      reason: "invalid_sender",
      diagnostic: "RESEND_FROM must contain one valid sender address without control characters.",
    };
  }
  if ([...UNSUPPORTED_SENDER_DOMAINS].some((domain) =>
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
