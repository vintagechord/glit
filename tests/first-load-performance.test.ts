import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasBrowserAuthCookie } from "../src/lib/supabase/browser-session";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("only real Supabase session cookies count as signed in", () => {
  assert.equal(hasBrowserAuthCookie(""), false);
  assert.equal(hasBrowserAuthCookie("theme=dark; sb-rwysjsmxtpuqekeltwxi-auth-token=base64-abc"), true);
  assert.equal(hasBrowserAuthCookie("sb-rwysjsmxtpuqekeltwxi-auth-token.0=base64-abc; sb-rwysjsmxtpuqekeltwxi-auth-token.1=def"), true);
  assert.equal(hasBrowserAuthCookie("sb-rwysjsmxtpuqekeltwxi-auth-token-code-verifier=xyz"), false, "a pending OAuth verifier is not a session");
  assert.equal(hasBrowserAuthCookie("my-sb-x-auth-token=1"), false);
});

test("the home page is served from the CDN and reads the session in the browser", () => {
  for (const page of ["src/app/page.tsx", "src/app/en/page.tsx"]) {
    const source = readSource(page);
    assert.doesNotMatch(source, /force-dynamic/, `${page} must stay cacheable`);
    assert.match(source, /export const revalidate = \d+;/);
  }
  const panel = readSource("src/features/home/home-session-panel.tsx");
  assert.match(panel, /^"use client";/);
  assert.doesNotMatch(panel, /createServerSupabase|getDashboardStatusData\(/);
  assert.match(panel, /dashboardStatusResource\.read/);
});

test("guests do not download the Supabase SDK or zod on first load", () => {
  for (const file of ["src/components/site/header.tsx", "src/features/home/home-review-panel.tsx", "src/features/home/home-session-panel.tsx"]) {
    assert.doesNotMatch(readSource(file), /from "@\/lib\/supabase\/client"/, `${file} must load the SDK on demand`);
  }
  assert.doesNotMatch(readSource("src/constants/review-status.ts"), /from "zod"/);
  assert.doesNotMatch(readSource("src/lib/support-chat-cursor.ts"), /from "(?:zod|@supabase\/[^"]+|@\/lib\/supabase\/[^"]+)"/);
});

test("auth, lookup and application pages are prerendered and resolve the visitor in the browser", () => {
  for (const page of [
    "src/app/login/page.tsx", "src/app/en/login/page.tsx", "src/app/signup/page.tsx", "src/app/en/signup/page.tsx",
    "src/app/track/page.tsx", "src/app/en/track/page.tsx",
    "src/app/dashboard/new/album/page.tsx", "src/app/en/dashboard/new/album/page.tsx", "src/app/dashboard/new/mv/page.tsx",
  ]) {
    assert.doesNotMatch(readSource(page), /searchParams|createServerSupabase|getServerSessionUser|force-dynamic/, `${page} must stay static`);
  }
  for (const view of [
    "src/features/auth/login-page-view.tsx", "src/features/auth/signup-page-view.tsx",
    "src/features/track/track-page-view.tsx", "src/app/dashboard/new/album/application-view.tsx",
  ]) {
    assert.doesNotMatch(readSource(view), /await searchParams|createServerSupabase|getServerSessionUser|\.auth\.getUser/, view);
  }
  // Provider settings are cached as parsed booleans only, never as the raw response.
  assert.match(readSource("src/features/auth/auth-provider-options.tsx"), /unstable_cache\(getSocialAvailability/);
  assert.match(readSource("src/proxy.ts"), /trackMemberRedirectPath\(pathname, request\.nextUrl\.searchParams\)/);
});
