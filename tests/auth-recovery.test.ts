import assert from "node:assert/strict";
import test from "node:test";
import { loginSchema, signupSchema, passwordUpdateSchema, toFieldErrors } from "../src/features/auth/validation";
import { isAuthConnectionError, mapAuthError } from "../src/features/auth/errors";

const signup = { email: "user@example.com", password: "safe-pass-123", confirmPassword: "safe-pass-123", agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on" };

test("Korean signup validation covers short/missing passwords, bad emails and agreements", () => {
  for (const input of [
    { ...signup, password: "short", confirmPassword: "short" },
    { ...signup, password: null, confirmPassword: null },
    { ...signup, email: "invalid", agreeAge: null },
    { ...signup, password: "p".repeat(129) },
  ]) {
    const result = signupSchema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) {
      const errors = toFieldErrors(result.error.flatten().fieldErrors);
      assert.ok(Object.keys(errors).length);
      for (const message of Object.values(errors)) {
        assert.match(message, /[가-힣]/);
        assert.doesNotMatch(message, /Too small|expected|Invalid input/);
      }
    }
  }
});

test("signup and password change require matching passwords and enforce policy", () => {
  assert.equal(signupSchema.safeParse(signup).success, true);
  assert.equal(signupSchema.safeParse({ ...signup, confirmPassword: "other-pass" }).success, false);
  assert.equal(passwordUpdateSchema.safeParse({ newPassword: "a".repeat(8), confirmPassword: "a".repeat(8) }).success, true);
  assert.equal(passwordUpdateSchema.safeParse({ newPassword: "a".repeat(129), confirmPassword: "a".repeat(129) }).success, false);
});

test("login accepts legacy passwords without imposing the new signup policy", () => {
  assert.equal(loginSchema.safeParse({ email: signup.email, password: "old123" }).success, true);
  assert.equal(loginSchema.safeParse({ email: signup.email, password: "" }).success, false);
});

test("provider errors and thrown transport errors produce the same safe Korean message", () => {
  const transport = new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  for (const error of [transport, { message: "fetch failed" }, { name: "AuthRetryableFetchError", status: 0 }, { cause: { code: "ENOTFOUND" } }]) {
    assert.equal(isAuthConnectionError(error), true);
    for (const operation of ["login", "signup", "reset", "update"] as const) {
      const message = mapAuthError(error, operation);
      assert.match(message, /인증 서버에 연결/);
      assert.doesNotMatch(message, /fetch|ENOTFOUND/);
    }
  }
  assert.match(mapAuthError({ code: "invalid_credentials" }, "login"), /이메일 또는 비밀번호/);
  assert.match(mapAuthError({ code: "email_not_confirmed" }, "login"), /이메일 인증/);
  assert.match(mapAuthError({ status: 429 }, "reset"), /요청이 너무 많/);
  assert.doesNotMatch(mapAuthError({ message: "secret raw provider payload" }, "reset"), /secret|raw|provider/);
});

import { readRecoveryCredential } from "../src/features/auth/recovery";

test("recovery accepts only purpose-scoped signed fragments and never exchanges browser sessions", () => {
  const token = "fixture-recovery-token-123456";
  const signature = "a".repeat(64);
  const valid = `#token_hash=${token}&type=recovery&signature=${signature}`;
  assert.deepEqual(readRecoveryCredential(new URL(`https://onside.test/reset-password${valid}`)), { token, signature });
  for (const suffix of ["", "?code=pkce", "?token_hash=legacy&type=recovery", "#access_token=access&refresh_token=refresh", `#token_hash=${token}&type=recovery`, `#token_hash=${token}&type=signup&signature=${signature}`, `?error=denied${valid}`, `?token_hash=legacy${valid}`, "#token_hash=&type=recovery&signature=" + signature]) {
    assert.equal(readRecoveryCredential(new URL(`https://onside.test/reset-password${suffix}`)), null);
  }
});

test("email provider quota is distinct from user throttling and same-password precedes weak-password wording", () => {
  assert.match(mapAuthError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "reset"), /메일 발송 서비스의 전송 한도/);
  assert.match(mapAuthError({ code: "same_password", message: "New password should be different from the old password." }, "update"), /현재 비밀번호와 다른/);
});
