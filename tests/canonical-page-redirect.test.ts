import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import type { NextRequest, NextResponse } from "next/server";

import { getCanonicalPageRedirect } from "../src/lib/canonical-page-redirect";

const legacyHost = "glit-b1yn.onrender.com";
const canonicalOrigin = "https://iamonside.com";
const input = (pathname: string, overrides: Partial<Parameters<typeof getCanonicalPageRedirect>[0]> = {}) => ({
  method: "GET", host: legacyHost, pathname, search: "", ...overrides,
});

test("known browser pages move to the configured HTTPS origin in both locales", () => {
  const pages = ["/", "/about", "/guide", "/forms", "/faq", "/support", "/studio", "/login", "/signup", "/forgot-password", "/confirm-email", "/reset-password", "/complete-signup", "/privacy", "/terms", "/subscription", "/karaoke-request", "/admin/users", "/dashboard/new/album", "/dashboard/pay/order", "/mypage/cart", "/track/token", "/submissions/submission", "/magazine", "/apply/album"];
  for (const path of pages) {
    for (const pathname of [path, path === "/" ? "/en" : `/en${path}`]) {
      for (const method of ["GET", "HEAD"]) {
        assert.equal(getCanonicalPageRedirect(input(pathname, { method }), canonicalOrigin)?.href, `${canonicalOrigin}${pathname}`);
      }
    }
  }
  assert.equal(getCanonicalPageRedirect(input("/en/privacy/"), canonicalOrigin)?.pathname, "/en/privacy/");
});

test("confirmation and recovery queries retain encoding, ordering and duplicate parameters", () => {
  const search = "?token_hash=fixture%2Btoken&type=recovery&next=%2Fen%2Fmypage%3Ftab%3Dorders&tag=one&tag=two";
  for (const pathname of ["/confirm-email", "/en/confirm-email", "/reset-password", "/en/reset-password"]) {
    const destination = getCanonicalPageRedirect(input(pathname, { search }), `${canonicalOrigin}/ignored?discarded=1#discarded`)!;
    assert.equal(destination.href, `${canonicalOrigin}${pathname}${search}`);
    assert.equal(destination.hash, "");
  }
});

test("callbacks, APIs, workers, assets and unknown paths stay on the original host", () => {
  const paths = ["/api/orders/return", "/api/internal/email-outbox", "/api/inicis/return", "/api/auth/callback", "/auth/callback", "/auth/social/google", "/auth/link/kakao", "/pay/inicis/return", "/pay/inicis/close", "/pay/inicis/popup", "/subscription/result", "/logout", "/healthz", "/readyz", "/dev/inicis-stdpay", "/_next/static/chunk.js", "/robots.txt", "/unknown", "/dashboard-evil", "/privacy/callback"];
  for (const path of paths) {
    for (const pathname of [path, `/en${path}`]) {
      assert.equal(getCanonicalPageRedirect(input(pathname), canonicalOrigin), null, pathname);
    }
  }
});

test("every state-changing method bypasses canonical redirects even on a known page", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"]) {
    for (const pathname of ["/", "/login", "/en/complete-signup", "/dashboard/new/album"]) {
      assert.equal(getCanonicalPageRedirect(input(pathname, { method }), canonicalOrigin), null, `${method} ${pathname}`);
    }
  }
});

test("in-flight payment receipts retain their original host in both locales", () => {
  const id = "a1b2c3d4-1111-4222-8333-123456789abc";
  for (const payment of ["success", "fail", "cancel", "error"]) {
    for (const path of [`/mypage/orders?focus=${id}&payment=${payment}`, `/dashboard/submissions/${id}?payment=${payment}`, `/track/guest-token_123?payment=${payment}`, `/karaoke-request?payment=${payment}`, `/karaoke-request?requestId=${id}&payment=${payment}`]) {
      for (const prefix of ["", "/en"]) {
        const receipt = new URL(`${canonicalOrigin}${prefix}${path}`);
        assert.equal(getCanonicalPageRedirect(input(receipt.pathname, { search: receipt.search }), canonicalOrigin), null, `${prefix}${path}`);
      }
    }
  }
});

test("payment receipt grace rejects unrelated pages and malformed or ambiguous receipt queries", () => {
  const id = "a1b2c3d4-1111-4222-8333-123456789abc";
  for (const path of [
    "/login?payment=success", "/admin?payment=success", "/dashboard/new/album?payment=success",
    "/mypage/orders?payment=success", "/mypage/orders?focus=invalid&payment=success",
    `/mypage/orders?focus=${id}&focus=${id}&payment=success`, `/mypage/orders?focus=${id}&payment=success&payment=fail`,
    `/mypage/orders?focus=${id}&payment=pending`, `/mypage/orders?focus=${id}`,
    "/dashboard/submissions/invalid?payment=success", `/dashboard/submissions/${id}/edit?payment=success`,
    "/track/short?payment=success", "/track/token%2Fsegment?payment=success",
    "/karaoke-request?requestId=invalid&payment=success", `/karaoke-request?requestId=${id}&requestId=${id}&payment=success`,
  ]) {
    const receipt = new URL(`${canonicalOrigin}${path}`);
    assert.equal(getCanonicalPageRedirect(input(receipt.pathname, { search: receipt.search }), canonicalOrigin)?.href, receipt.href, path);
  }
});

test("only the exact old Host can redirect; aliases, ports and malformed values cannot", () => {
  assert.equal(getCanonicalPageRedirect(input("/", { host: legacyHost.toUpperCase() }), canonicalOrigin)?.origin, canonicalOrigin);
  for (const host of [null, "iamonside.com", "localhost:3000", `www.${legacyHost}`, `${legacyHost}.`, `${legacyHost}:443`, `${legacyHost}.attacker.invalid`, ` ${legacyHost}`, `${legacyHost},attacker.invalid`, `${legacyHost}/`, `${legacyHost}@attacker.invalid`, `${legacyHost}\\attacker.invalid`]) {
    assert.equal(getCanonicalPageRedirect(input("/", { host }), canonicalOrigin), null, String(host));
  }
});

test("missing, unsafe and unchanged canonical origins leave requests untouched", () => {
  for (const origin of ["", "not a URL", "http://iamonside.com", "javascript:alert(1)", "https://user:password@iamonside.com", `https://${legacyHost}`, `https://${legacyHost}:443/path`]) {
    assert.equal(getCanonicalPageRedirect(input("/login"), origin), null, origin);
  }
});

test("paths cannot switch the destination host or normalize into an excluded callback", () => {
  for (const pathname of ["//attacker.invalid/login", "/dashboard/../auth/callback", "/dashboard/%2e%2e/api/orders", "/dashboard\\..\\auth\\callback"]) {
    assert.equal(getCanonicalPageRedirect(input(pathname), canonicalOrigin), null, pathname);
  }
  const destination = getCanonicalPageRedirect(input("/dashboard/new/album", { search: "?next=//attacker.invalid&redirect=https://attacker.invalid" }), canonicalOrigin)!;
  assert.equal(destination.origin, canonicalOrigin);
});

type Harness = {
  proxy: (request: NextRequest) => Promise<NextResponse>;
  state: { sessionCalls: number };
};
const bundle = build({
  stdin: { contents: `export {default as proxy} from './src/proxy'; export {state} from 'canonical-fixture';`, loader: "ts", resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "canonical-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(canonical-fixture|@\/lib\/supabase\/middleware)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", resolveDir: process.cwd(), contents: path === "canonical-fixture"
      ? `export const state={sessionCalls:0};`
      : `import {NextResponse} from 'next/server'; import {state} from 'canonical-fixture'; export async function middleware(){state.sessionCalls++;const response=NextResponse.next();response.cookies.set('fixture-rotated','value');return response;}`,
    }));
  } }],
});
const require = createRequire(import.meta.url);
const { NextRequest: RequestClass } = require("next/server") as typeof import("next/server");
async function harness() {
  const compiled = await bundle;
  const mod = { exports: {} as Harness };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports;
}

test("proxy redirects before touching sessions or cookies, including Render internal HTTP requests", async (t) => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = canonicalOrigin;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
  const h = await harness();
  for (const method of ["GET", "HEAD"]) {
    const response = await h.proxy(new RequestClass("http://internal:3000/en/mypage?tab=orders", {
      method, headers: { host: legacyHost, "x-forwarded-host": "attacker.invalid", cookie: "sb-fixture-auth-token=old-session" },
    }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `${canonicalOrigin}/en/mypage?tab=orders`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(h.state.sessionCalls, 0);
});

test("proxy ignores forwarded host aliases and preserves actions and auth callbacks", async (t) => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = canonicalOrigin;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
  const h = await harness();
  for (const [method, host, pathname] of [["GET", "iamonside.com", "/login"], ["GET", "unknown.invalid", "/login"], ["POST", legacyHost, "/complete-signup"], ["POST", legacyHost, "/dashboard/new/album"], ["GET", legacyHost, "/auth/callback?code=fixture"], ["GET", legacyHost, "/api/inicis/return"], ["GET", legacyHost, "/pay/inicis/return"], ["GET", legacyHost, "/subscription/result"]]) {
    const response = await h.proxy(new RequestClass(`https://${host}${pathname}`, {
      method, headers: { host, "x-forwarded-host": legacyHost, "next-action": "fixture-action" },
    }));
    assert.equal(response.status, 200, `${method} ${pathname}`);
    assert.equal(response.headers.get("location"), null);
  }
  assert.equal(h.state.sessionCalls, 0);
});

test("legacy receipt grace still runs existing authentication and session-cookie handling", async (t) => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = canonicalOrigin;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
  const h = await harness();
  const id = "a1b2c3d4-1111-4222-8333-123456789abc";
  const protectedPath = `/en/dashboard/submissions/${id}?payment=success`;
  const blocked = await h.proxy(new RequestClass(`https://${legacyHost}${protectedPath}`, { headers: { host: legacyHost } }));
  const login = new URL(blocked.headers.get("location")!);
  assert.equal(blocked.status, 307);
  assert.equal(login.origin, `https://${legacyHost}`);
  assert.equal(login.pathname, "/en/login");
  assert.equal(login.searchParams.get("next"), protectedPath);
  const receipt = await h.proxy(new RequestClass(`https://${legacyHost}/mypage/orders?focus=${id}&payment=success`, {
    headers: { host: legacyHost, cookie: "sb-fixture-auth-token=old-session" },
  }));
  assert.equal(receipt.status, 200);
  assert.equal(receipt.headers.get("location"), null);
  assert.equal(receipt.cookies.get("fixture-rotated")?.value, "value");
  assert.equal(h.state.sessionCalls, 1);
});
