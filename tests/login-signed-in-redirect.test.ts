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
