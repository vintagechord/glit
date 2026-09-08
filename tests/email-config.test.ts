import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEmailProviderFailure,
  getEmailSenderConfiguration,
} from "../src/lib/email-config";

test("email sender requires an explicit address and never substitutes the support inbox", () => {
  for (const from of [undefined, null, "", "   "]) {
    const result = getEmailSenderConfiguration({ from, supportEmail: "private-support@daum.net" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing_sender");
    assert.doesNotMatch(JSON.stringify(result), /private-support/);
  }
});

test("sender formatting supports own domains and keeps a public support inbox as reply-to", () => {
  for (const [from, expected] of [
    [" Notify+Recovery@Mail.Onside17.com ", "Notify+Recovery@mail.onside17.com"],
    [" 온사이드 <notify@onside17.com> ", "온사이드 <notify@onside17.com>"],
    ['"Onside, Inc." <notify@onside17.com>', '"Onside, Inc." <notify@onside17.com>'],
  ]) {
    const result = getEmailSenderConfiguration({ from, supportEmail: " myonside@DAUM.NET " });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.from, expected);
    assert.equal(result.replyTo, "myonside@daum.net");
    assert.ok(result.senderDomain.endsWith("onside17.com"));
  }
});

test("syntax validation permits isolated fixtures and does not claim DNS verification", () => {
  for (const from of [
    "notify@example.invalid", "notify@onside.test", "notify@outlook.company.test",
    "notify@company-gmail.com", "notify@gmail.com.owned.test", "notify@xn--example-9za.test",
  ]) {
    const result = getEmailSenderConfiguration({ from });
    assert.equal(result.ok, true, from);
    assert.equal("verified" in result, false);
    assert.equal("replyTo" in result, false);
  }
});

test("public mailbox and restricted test domains cannot be sender domains", () => {
  for (const domain of [
    "daum.net", "hanmail.net", "gmail.com", "googlemail.com", "naver.com", "nate.com",
    "kakao.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "yahoo.co.kr",
    "proton.me", "protonmail.com", "resend.dev", "MAIL.DAUM.NET", "nested.gmail.com",
  ]) {
    const result = getEmailSenderConfiguration({ from: `Private User <private-recipient@${domain}>` });
    assert.equal(result.ok, false, domain);
    if (!result.ok) assert.equal(result.reason, "unsupported_sender_domain");
    assert.doesNotMatch(JSON.stringify(result), /private-recipient|Private User/);
  }
});

test("malformed senders, multiple addresses and control characters are rejected", () => {
  for (const from of [
    "not-an-email", "Name <notify@example.invalid", "Name notify@example.invalid>",
    "notify@example.invalid,other@example.invalid", "Name <notify@example.invalid>;",
    "Name <notify@example.invalid> <other@example.invalid>", 'Name" <notify@example.invalid>',
    "Name, Inc <notify@example.invalid>", "<notify@example.invalid>",
    "Bcc: other@example.invalid <notify@example.invalid>", "Name [extra] <notify@example.invalid>",
    "Name; Bcc: target <notify@example.invalid>", "Name\\ <notify@example.invalid>",
    "Name <notify@example.invalid>\r\nBcc: victim@example.invalid",
    "notify@example.invalid\n", "\r\n", "Name\t<notify@example.invalid>",
    "Name\u0000<notify@example.invalid>", "Name\u0085<notify@example.invalid>",
    "Name\u2028<notify@example.invalid>", "Name\u2029<notify@example.invalid>",
    ".notify@example.invalid", "notify.@example.invalid", "no..tify@example.invalid",
    "no tify@example.invalid", "notify@@example.invalid", "notify@example",
    "notify@-example.invalid", "notify@example-.invalid", "notify@exa_mple.invalid",
    "notify@example..invalid", "notify@example.invalid.", "notify@127.0.0.1",
    `${"a".repeat(65)}@example.invalid`, `notify@${"a".repeat(64)}.invalid`,
  ]) {
    const result = getEmailSenderConfiguration({ from });
    assert.equal(result.ok, false, JSON.stringify(from));
    if (!result.ok) assert.equal(result.reason, "invalid_sender");
    assert.doesNotMatch(JSON.stringify(result), /victim|notify|Bcc/);
  }
});

test("invalid support addresses are omitted without breaking an otherwise valid sender", () => {
  for (const supportEmail of [
    undefined, null, "", "no-email", "help@example.invalid\r\nBcc: other@example.invalid",
    "first@example.invalid,second@example.invalid", "Name <help@example.invalid>",
  ]) {
    assert.deepEqual(getEmailSenderConfiguration({ from: "notify@example.invalid", supportEmail }), {
      ok: true, from: "notify@example.invalid", senderDomain: "example.invalid",
    });
  }
});

test("provider failures classify HTTP errors without echoing unknown provider values", () => {
  const untrusted = [
    undefined, null, 123, { name: "validation_error", message: "private-recipient" },
    "private-recipient@example.invalid", "token_hash=private-recovery-token", "validation_error\nsecret",
    "VALIDATION_ERROR", "validation_error ", "__proto__", "toString",
  ];
  for (const [status, reason] of [
    [400, "configuration"], [401, "configuration"], [403, "configuration"], [422, "configuration"],
    [429, "rate_limit"], [409, "delivery"], [500, "delivery"], [503, "delivery"], [0, "delivery"],
  ] as const) {
    for (const providerName of untrusted) {
      const result = classifyEmailProviderFailure(status, providerName);
      assert.deepEqual(result, { reason, diagnostic: `email_${reason}_error` });
      assert.doesNotMatch(JSON.stringify(result), /private-|token_hash|secret|__proto__|toString/);
    }
  }
});

test("only documented provider names survive as fixed diagnostic codes", () => {
  for (const providerName of [
    "invalid_idempotency_key", "validation_error", "missing_api_key", "restricted_api_key",
    "email_above_quota", "invalid_permission", "suspended_api_key", "not_found", "method_not_allowed",
    "concurrent_idempotent_requests", "invalid_idempotent_request", "resource_locked",
    "invalid_attachment", "invalid_parameter", "missing_required_field", "missing_required_parameter",
    "daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded", "application_error",
    "service_unavailable",
  ]) {
    assert.equal(classifyEmailProviderFailure(403, providerName).diagnostic, `resend_${providerName}`);
  }
  assert.deepEqual(classifyEmailProviderFailure(429, "daily_quota_exceeded"), {
    reason: "rate_limit", diagnostic: "resend_daily_quota_exceeded",
  });
  assert.deepEqual(classifyEmailProviderFailure(503, "service_unavailable"), {
    reason: "delivery", diagnostic: "resend_service_unavailable",
  });
});
