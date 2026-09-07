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

import { verifyRecoverySession } from "../src/features/auth/recovery";

function recoveryAuth(failing = "", hasExistingSession = false) {
  const calls: Array<{ method: string; value?: unknown }> = [];
  const response = (method: string, value?: unknown) => {
    calls.push({ method, value });
    return Promise.resolve({ data: { session: failing === method ? null : { user: { id: "recovery-user" } } }, error: failing === method ? new Error("invalid flow state") : null });
  };
  const auth = {
    getSession: async () => { calls.push({ method: "getSession" }); return { data: { session: hasExistingSession ? { user: { id: "previous-user" } } : null }, error: null }; },
    exchangeCodeForSession: (value: string) => response("exchangeCodeForSession", value),
    verifyOtp: (value: unknown) => response("verifyOtp", value),
    setSession: (value: unknown) => response("setSession", value),
  } as unknown as Parameters<typeof verifyRecoverySession>[0];
  return { auth, calls };
}

test("recovery exchanges PKCE, token hashes, and implicit sessions through their own methods", async () => {
  for (const [suffix, expected] of [["?code=pkce-code", "exchangeCodeForSession"], ["?token_hash=otp-hash", "verifyOtp"], ["#access_token=access&refresh_token=refresh", "setSession"]]) {
    const { auth, calls } = recoveryAuth();
    assert.deepEqual(await verifyRecoverySession(auth, new URL(`https://onside.test/reset-password${suffix}`)), { ok: true });
    assert.equal(calls.length, 1); assert.equal(calls[0].method, expected);
  }
});

test("invalid PKCE and error links cannot fall back to an unrelated existing session or OTP", async () => {
  const { auth, calls } = recoveryAuth("exchangeCodeForSession", true);
  const result = await verifyRecoverySession(auth, new URL("https://onside.test/reset-password?code=invalid"));
  assert.equal(result.ok, false);
  assert.deepEqual(calls.map((call) => call.method), ["exchangeCodeForSession"]);
  const existing = recoveryAuth("", true);
  assert.equal((await verifyRecoverySession(existing.auth, new URL("https://onside.test/reset-password#error=access_denied&error_description=secret"))).ok, false);
  assert.equal(existing.calls.length, 0);
});

test("partial implicit credentials are rejected, while already exchanged sessions can resume", async () => {
  const partial = recoveryAuth();
  assert.equal((await verifyRecoverySession(partial.auth, new URL("https://onside.test/reset-password#access_token=access"))).ok, false);
  assert.equal(partial.calls.length, 0);
  const resumed = recoveryAuth("", true);
  assert.deepEqual(await verifyRecoverySession(resumed.auth, new URL("https://onside.test/reset-password")), { ok: true });
  assert.deepEqual(resumed.calls.map((call) => call.method), ["getSession"]);
});
