import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("a member who is still signed in is sent on from the login page instead of seeing an empty form", () => {
  const form = readFileSync("src/features/auth/login-form.tsx", "utf8");
  // Guests never load the SDK: the check starts from the session cookie.
  assert.match(form, /if \(!hasBrowserAuthCookie\(\)\) return;/);
  // The auth server confirms the account first. A cookie it no longer accepts
  // must leave the form in place, or the page and the login guard would bounce.
  assert.match(form, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(form, /supabase\.auth\.getSession\(\)/);
  assert.match(form, /window\.location\.replace\(effectiveNextPath \?\? \(isEnglishRoute \? "\/en\/mypage" : "\/mypage"\)\)/);
  // The destination is the validated return path, never the raw query value.
  assert.match(form, /const effectiveNextPath = getAuthReturnPath\(/);
});

test("an unfinished social signup stays on the login form so 다른 계정으로 로그인 can switch accounts", async () => {
  // /complete-signup links here to sign in with another account. Sending that
  // user on to /mypage only made the proxy return them to /complete-signup.
  const form = readFileSync("src/features/auth/login-form.tsx", "utf8");
  assert.match(form, /import \{ requiresSocialSignupCompletion \} from "\.\/social-contract";/);
  assert.match(form, /if \(!active \|\| error \|\| !data\.user \|\| requiresSocialSignupCompletion\(data\.user\)\) return;/);
  const { requiresSocialSignupCompletion } = await import("../src/features/auth/social-contract");
  const kakaoOnly = { app_metadata: { provider: "kakao", providers: ["kakao"] }, identities: [{ provider: "kakao" }], user_metadata: {} };
  assert.equal(requiresSocialSignupCompletion(kakaoOnly as never), true);
});
