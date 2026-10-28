import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import type { User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

const consent = { age14OrOlder: true, terms: true, privacy: true, refund: true, acceptedAt: "2026-10-29T00:00:00Z" };
const socialUser = (metadata: Record<string, unknown> = {}): User => ({
  id: "social-member", aud: "authenticated", created_at: "2026-10-29T00:00:00Z",
  app_metadata: { provider: "custom:naver", providers: ["custom:naver"], ...metadata },
  user_metadata: {}, identities: [],
});

type Harness = {
  createServerSupabase: typeof import("../src/lib/supabase/server").createServerSupabase;
  getServerSessionUser: typeof import("../src/lib/supabase/server-user").getServerSessionUser;
  proxy: (request: NextRequest) => Promise<NextResponse>;
  config: { matcher: string[] };
  state: {
    verifiedUser: User | null;
    optimisticUser: User | null;
    verifiedError: Error | null;
    verifiedCalls: unknown[][];
    sessionCalls: number;
    options: Array<{ auth?: { experimental?: { appendPkceFlowIdToRedirects?: boolean } } }>;
  };
};

const bundle = build({
  stdin: { contents: `export {createServerSupabase} from './src/lib/supabase/server'; export {getServerSessionUser} from './src/lib/supabase/server-user'; export {default as proxy,config} from './src/proxy'; export {state} from 'guard-fixture';`, loader: "ts", resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "guard-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(guard-fixture|@supabase\/ssr|next\/headers|\.\/env)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: {
      "guard-fixture": `export const state={verifiedUser:null,optimisticUser:null,verifiedError:null,verifiedCalls:[],sessionCalls:0,options:[]};`,
      "./env": `export const getSupabaseEnv=()=>({url:'https://fixture.invalid',anonKey:'fixture-only'});`,
      "next/headers": `export const cookies=async()=>({getAll:()=>[],set(){}});`,
      "@supabase/ssr": `import {state} from 'guard-fixture'; export function createServerClient(_url,_key,options){state.options.push(options);return {auth:{getUser:async(...args)=>{state.verifiedCalls.push(args);return {data:{user:state.verifiedUser},error:state.verifiedError}},getSession:async()=>{state.sessionCalls++;options.cookies.setAll([{name:'sb-fixture-auth-token',value:'rotated',options:{path:'/',httpOnly:true}}],{'Cache-Control':'private, no-store'});return {data:{session:state.optimisticUser?{user:state.optimisticUser}:null},error:null}}}};}`,
    }[path]! }));
  } }],
});

async function harness() {
  const compiled = await bundle;
  const mod = { exports: {} as Harness };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  return mod.exports;
}
const require = createRequire(import.meta.url);
const { NextRequest: RequestClass } = require("next/server") as typeof import("next/server");
const request = (path: string, headers: Record<string, string> = {}) => new RequestClass(`https://onside.test${path}`, {
  headers: { cookie: "sb-fixture-auth-token=session", ...headers },
});

test("direct and shared user reads reject incomplete social accounts after one verified lookup", async () => {
  const h = await harness(); h.state.verifiedUser = socialUser();
  const client = await h.createServerSupabase();
  const result = await client.auth.getUser("explicit-test-token");
  assert.equal(result.data.user, null);
  assert.equal(result.error?.status, 403);
  assert.equal(result.error?.code, "social_signup_incomplete");
  assert.deepEqual(h.state.verifiedCalls, [["explicit-test-token"]]);
  assert.equal(await h.getServerSessionUser(client), null);
  assert.equal(h.state.verifiedCalls.length, 2);
  assert.equal(h.state.sessionCalls, 0);
});

test("consented email-less social members and legacy email members retain access", async () => {
  const h = await harness(); const client = await h.createServerSupabase();
  for (const user of [socialUser({ signupConsent: consent }), socialUser({ provider: "email", providers: ["email"] }), socialUser({ providers: ["email", "google"] })]) {
    h.state.verifiedUser = user;
    assert.equal((await client.auth.getUser()).data.user?.id, user.id);
    assert.equal(h.state.verifiedCalls.length > 0, true);
  }
  assert.equal(h.state.verifiedCalls.length, 3);
});

test("editable user metadata cannot satisfy required server consent", async () => {
  const h = await harness();
  h.state.verifiedUser = { ...socialUser(), user_metadata: { signupConsent: consent } };
  const client = await h.createServerSupabase();
  assert.equal((await client.auth.getUser()).data.user, null);
  h.state.verifiedUser = socialUser({ signupConsent: { ...consent, refund: false } });
  assert.equal((await client.auth.getUser()).data.user, null);
});

test("completion-only bypass preserves verified identity and opt-in PKCE configuration", async () => {
  const h = await harness(); h.state.verifiedUser = socialUser();
  const client = await h.createServerSupabase({ allowIncompleteSocialSignup: true, appendPkceFlowIdToRedirects: true });
  assert.equal((await client.auth.getUser()).data.user?.id, "social-member");
  assert.equal(h.state.verifiedCalls.length, 1);
  assert.equal(h.state.options[0].auth?.experimental?.appendPkceFlowIdToRedirects, true);
  await h.createServerSupabase();
  assert.equal(h.state.options[1].auth, undefined);
  h.state.verifiedError = new Error("original verification error");
  h.state.verifiedUser = null;
  assert.equal((await client.auth.getUser()).error, h.state.verifiedError);
});

test("optimistic route guards preserve locale, destination and rotated cookies", async () => {
  const h = await harness(); h.state.optimisticUser = socialUser();
  for (const path of ["/en/mypage/orders?focus=order", "/en/dashboard/new/album?draft=saved", "/en", "/subscription"]) {
    const response = await h.proxy(request(path));
    const destination = new URL(response.headers.get("location")!);
    assert.equal(destination.pathname, path.startsWith("/en") ? "/en/complete-signup" : "/complete-signup");
    assert.equal(destination.searchParams.get("next"), path);
    assert.equal(response.cookies.get("sb-fixture-auth-token")?.value, "rotated");
    assert.match(response.headers.get("cache-control")!, /private.*no-store/);
  }
  assert.equal(h.state.sessionCalls, 4);
  assert.equal(h.state.verifiedCalls.length, 0);
});

test("pending API sessions are rejected with a safe localized completion destination", async () => {
  const h = await harness(); h.state.optimisticUser = socialUser();
  const response = await h.proxy(request("/api/submissions/draft", { referer: "https://onside.test/en/dashboard/new/album?draft=saved" }));
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.code, "SOCIAL_SIGNUP_INCOMPLETE");
  const destination = new URL(payload.redirectTo, "https://onside.test");
  assert.equal(destination.pathname, "/en/complete-signup");
  assert.equal(destination.searchParams.get("next"), "/en/dashboard/new/album?draft=saved");
  const external = await h.proxy(request("/api/orders", { referer: "https://external.invalid/en/private" }));
  assert.equal(new URL((await external.json()).redirectTo, "https://onside.test").searchParams.get("next"), "/mypage");
});

test("auth completion and anonymous public requests do not run extra session lookups", async () => {
  const h = await harness(); h.state.optimisticUser = socialUser();
  for (const path of ["/login", "/en/signup", "/auth/social/google", "/api/auth/callback", "/en/complete-signup?next=/en/mypage", "/logout", "/reset-password"]) {
    assert.equal((await h.proxy(request(path))).status, 200, path);
  }
  for (const path of ["/", "/dashboard/new/album", "/api/orders"]) {
    assert.equal((await h.proxy(new RequestClass(`https://onside.test${path}`))).status, 200, path);
  }
  assert.equal(h.state.sessionCalls, 0);
  assert.equal(h.state.verifiedCalls.length, 0);
});

test("forged optimistic cookie metadata cannot bypass the verified server guard", async () => {
  const h = await harness();
  h.state.optimisticUser = socialUser({ signupConsent: consent });
  h.state.verifiedUser = socialUser();
  assert.equal((await h.proxy(request("/mypage"))).status, 200);
  assert.equal(await h.getServerSessionUser(await h.createServerSupabase()), null);
  assert.equal(h.state.verifiedCalls.length, 1);
});

test("the proxy covers data routes while excluding static assets", async () => {
  const h = await harness();
  const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server") as typeof import("next/experimental/testing/server");
  for (const path of ["/mypage", "/en/mypage/music", "/subscription", "/api/uploads/presign", "/api/music-archive", "/dashboard/new/album"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: h.config, nextConfig: {}, url: path }), true, path);
  }
  for (const path of ["/_next/static/chunk.js", "/_next/image?url=cover", "/station-logos/kbs.svg", "/favicon.ico", "/robots.txt"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: h.config, nextConfig: {}, url: path }), false, path);
  }
});
