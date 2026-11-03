import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { memberSignInFromAuthUser, signInMethodLabel } from "../src/lib/admin/member-sign-in";

test("the sign-up method is the earliest identity, with app metadata as the fallback", () => {
  assert.deepEqual(memberSignInFromAuthUser({
    app_metadata: { provider: "google", providers: ["kakao", "google"] },
    identities: [{ provider: "google", created_at: "2026-11-02T00:00:00Z" }, { provider: "kakao", created_at: "2026-11-01T00:00:00Z" }],
  }), { signupProvider: "kakao", providers: ["kakao", "google"] });
  assert.deepEqual(memberSignInFromAuthUser({ app_metadata: { provider: "custom:naver", providers: ["custom:naver"] }, identities: [] }),
    { signupProvider: "custom:naver", providers: ["custom:naver"] });
  assert.deepEqual(memberSignInFromAuthUser({ app_metadata: { provider: "email" } }), { signupProvider: "email", providers: ["email"] });
  assert.deepEqual(memberSignInFromAuthUser(null), { signupProvider: null, providers: [] });
});

test("provider names read as Korean labels; Naver's custom OIDC id never leaks", () => {
  assert.equal(signInMethodLabel("email"), "이메일");
  assert.equal(signInMethodLabel("custom:naver"), "네이버");
  assert.equal(signInMethodLabel("kakao"), "카카오");
  assert.equal(signInMethodLabel("google"), "구글");
  assert.equal(signInMethodLabel(null), "확인 불가");
});

test("the sign-in method function is read-only, bounded and service-role only", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261103210000_admin_auth_user_sign_in_methods.sql", import.meta.url), "utf8");
  assert.match(sql, /language sql stable security definer set search_path = ''/);
  assert.match(sql, /\[1:200\]/);
  assert.match(sql, /revoke all on function public\.admin_auth_user_accounts\(uuid\[\]\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.admin_auth_user_accounts\(uuid\[\]\) to service_role;/);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\b/i);
});
