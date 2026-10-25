import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import type { NextRequest, NextResponse } from "next/server";

test("session refresh reaches downstream request cookies, browser cookies and no-cache headers", async () => {
  const result = await build({
    stdin: {
      contents: `export {middleware} from './src/lib/supabase/middleware'; export {createClient} from './src/lib/supabase/client'; export {default as proxy} from './src/proxy';`,
      resolveDir: process.cwd(), loader: "ts",
    },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "session-cookie-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(?:@supabase\/ssr|\.\/env)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        loader: "js",
        contents: path === "./env"
          ? `export const getSupabaseEnv = () => ({url:'https://fixture.invalid',anonKey:'fixture-only'});`
          : `
            export const createBrowserClient = (_url,_key,options) => options;
            export function createServerClient(_url,_key,{cookies}) {
              return {auth:{getSession:async()=>{
                const headers={'Cache-Control':'private, no-cache, no-store, must-revalidate, max-age=0',Expires:'0',Pragma:'no-cache'};
                cookies.setAll([{name:'sb-fixture-auth-token.0',value:'refreshed-part-one',options:{path:'/',httpOnly:true}}],headers);
                cookies.setAll([{name:'sb-fixture-auth-token.1',value:'refreshed-part-two',options:{path:'/',httpOnly:true}}],headers);
                return {data:{session:{user:{id:'fixture-user'}}}};
              }}};
            }`,
      }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const bundled = { exports: {} as {
    middleware: (req: NextRequest) => Promise<{ response: NextResponse; user: { id: string } }>;
    proxy: (req: NextRequest) => Promise<NextResponse>;
    createClient: () => { auth: { detectSessionInUrl: boolean } };
  } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, bundled, bundled.exports);
  const { NextRequest: RequestClass } = require("next/server") as typeof import("next/server");
  const request = new RequestClass("https://onside.test/mypage", {
    headers: { cookie: "sb-fixture-auth-token.0=expired-part-one; sb-fixture-auth-token.1=expired-part-two" },
  });
  const { response, user } = await bundled.exports.middleware(request);
  assert.equal(user.id, "fixture-user");
  for (const [name, value] of [
    ["sb-fixture-auth-token.0", "refreshed-part-one"],
    ["sb-fixture-auth-token.1", "refreshed-part-two"],
  ]) {
    assert.equal(request.cookies.get(name)?.value, value);
    assert.equal(response.cookies.get(name)?.value, value);
    assert.ok(response.headers.get("x-middleware-request-cookie")?.includes(`${name}=${value}`));
  }
  assert.match(response.headers.get("Cache-Control") ?? "", /private.*no-store/);
  assert.equal(response.headers.get("Expires"), "0");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(bundled.exports.createClient().auth.detectSessionInUrl, false);

  const redirectRequest = new RequestClass("https://onside.test/admin/submissions/11111111-1111-4111-8111-111111111111", {
    headers: { cookie: "sb-fixture-auth-token.0=expired-part-one; sb-fixture-auth-token.1=expired-part-two" },
  });
  const redirect = await bundled.exports.proxy(redirectRequest);
  assert.equal(redirect.status, 307);
  assert.match(redirect.headers.get("location") ?? "", /\/admin\/submissions\/detail\?id=/);
  assert.equal(redirect.cookies.get("sb-fixture-auth-token.0")?.value, "refreshed-part-one");
  assert.equal(redirect.cookies.get("sb-fixture-auth-token.1")?.value, "refreshed-part-two");
  assert.match(redirect.headers.get("Cache-Control") ?? "", /private.*no-store/);
  assert.equal(redirect.headers.get("Expires"), "0");
  assert.equal(redirect.headers.get("Pragma"), "no-cache");

  // Public wizard and cart pages render member state too; a returning member
  // must receive the rotated token there, while guests pass straight through.
  for (const path of ["/dashboard/new/album", "/mypage/cart", "/en/mypage/orders"]) {
    const publicRequest = new RequestClass(`https://onside.test${path}`, {
      headers: { cookie: "sb-fixture-auth-token.0=expired-part-one; sb-fixture-auth-token.1=expired-part-two" },
    });
    const publicResponse = await bundled.exports.proxy(publicRequest);
    assert.equal(publicResponse.status, 200, path);
    assert.equal(publicResponse.cookies.get("sb-fixture-auth-token.0")?.value, "refreshed-part-one", path);
    assert.equal(publicResponse.cookies.get("sb-fixture-auth-token.1")?.value, "refreshed-part-two", path);
  }
  const guestResponse = await bundled.exports.proxy(new RequestClass("https://onside.test/dashboard/new/album"));
  assert.equal(guestResponse.status, 200);
  assert.equal(guestResponse.cookies.getAll().length, 0);
});
