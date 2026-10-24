import assert from "node:assert/strict";
import test from "node:test";
import { getAuthPageHref, getAuthReturnPath } from "../src/features/auth/navigation";

test("signup and successful signup preserve the draft query and selected locale", () => {
  const draft = "/dashboard/new?type=mv&draft=fixture-id#upload";
  const signup = new URL(getAuthPageHref("signup", draft, true), "https://onside.invalid");
  assert.equal(signup.pathname, "/en/signup");
  assert.equal(signup.searchParams.get("next"), `/en${draft}`);
  const login = new URL(getAuthPageHref("login", signup.searchParams.get("next"), true, true), signup.origin);
  assert.equal(login.pathname, "/en/login");
  assert.equal(login.searchParams.get("signup"), "success");
  assert.equal(login.searchParams.get("next"), `/en${draft}`);
  assert.equal(getAuthReturnPath(login.searchParams.get("next"), false), draft);
});

test("authentication return paths reject external targets and authentication loops", () => {
  for (const next of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/login?next=/mypage", "/en/signup", "/reset-password?token=fixture", "/forgot-password", "/en/confirm-email", "/find-id", `/mypage?${"x".repeat(2048)}`]) {
    assert.equal(getAuthReturnPath(next), null, next);
    assert.equal(getAuthPageHref("signup", next), "/signup");
  }
  assert.equal(getAuthReturnPath("/admin/review-docs?fixture=1", true), "/admin/review-docs?fixture=1");
});
