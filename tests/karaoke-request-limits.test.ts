import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

type Fixture = {
  createKaraokeRequestAction: (payload: Record<string, unknown>) => Promise<{ error?: string; message?: string }>;
  state: { user: { id: string } | null; deny: string[]; limits: Array<{ namespace: string; identifier: string; limit: number; windowMs: number }> };
  calls: Array<{ name: string; args: Record<string, unknown> }>;
};

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: "export {createKaraokeRequestAction} from './src/features/karaoke/actions'; export {state,calls} from 'karaoke-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "karaoke-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(karaoke-fixture|@\/lib\/supabase\/(?:server|admin)|@\/lib\/request-rate-limit|@\/lib\/admin\/action-auth|@\/lib\/b2|next\/(?:headers|navigation))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'karaoke-fixture';";
        const modules: Record<string, string> = {
          "karaoke-fixture": "export const calls=[]; export const state={user:null,deny:[],limits:[]};",
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:state.user},error:null})}});`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:[{result_request_id:'request-1'}],error:null};}});`,
          "@/lib/request-rate-limit": `${shared} export const consumePersistentRateLimit=async input=>{state.limits.push(input);const allowed=!state.deny.includes(input.namespace);return {allowed,retryAfterSeconds:allowed?0:60};}; export const getRequestIdentifier=headers=>headers.get('x-real-ip')||'unknown';`,
          "@/lib/admin/action-auth": "export const requireAdminAction=async()=>({id:'admin'});",
          "@/lib/b2": "export const getB2Config=()=>({prefix:'submissions/'});",
          "next/headers": "export const headers=async()=>new Headers({'x-real-ip':'198.51.100.9'});",
          "next/navigation": "export const redirect=url=>{throw Error('redirect:'+url)};",
        };
        return { contents: modules[path], loader: "js" };
      });
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

const guestRequest = { title: "노래", artist: "가수", contact: "010-0000-0000", paymentMethod: "BANK", bankDepositorName: "홍길동", guestName: "홍길동", guestEmail: "Guest@Example.invalid" };

test("guest karaoke requests pass shared per-address and per-email limits before the request is stored", async () => {
  const karaoke = await fixture();
  assert.equal((await karaoke.createKaraokeRequestAction(guestRequest)).message, "노래방 등록 요청이 접수되었습니다.");
  assert.deepEqual(karaoke.state.limits.map(limit => [limit.namespace, limit.identifier]), [
    ["karaoke-request-ip", "198.51.100.9"], ["karaoke-request-ip-day", "198.51.100.9"], ["karaoke-request-guest-email", "Guest@Example.invalid"],
  ]);
  assert.equal(karaoke.calls.length, 1);
  for (const namespace of ["karaoke-request-ip", "karaoke-request-ip-day", "karaoke-request-guest-email"]) {
    const limited = await fixture();
    limited.state.deny = [namespace];
    assert.match((await limited.createKaraokeRequestAction(guestRequest)).error ?? "", /노래방 등록 요청이 너무 많습니다/);
    assert.equal(limited.calls.length, 0, `${namespace} must stop the request before it is stored`);
  }
});

test("member karaoke requests are limited per member, and invalid input spends nothing", async () => {
  const karaoke = await fixture();
  karaoke.state.user = { id: "member-1" };
  await karaoke.createKaraokeRequestAction({ title: "노래", contact: "010-0000-0000", paymentMethod: "BANK", bankDepositorName: "회원" });
  assert.deepEqual(karaoke.state.limits.at(-1), { namespace: "karaoke-request-user", identifier: "member-1", limit: 10, windowMs: 3_600_000 });
  const invalid = await fixture();
  assert.equal((await invalid.createKaraokeRequestAction({ title: "" })).error, "입력값을 확인해주세요.");
  assert.equal(invalid.state.limits.length, 0);
});

test("admin karaoke list pages with a stable order and keeps the page after saving", () => {
  const page = readFileSync("src/app/admin/karaoke/page.tsx", "utf8");
  assert.match(page, /\.select\(selectFields, \{ count: "exact" \}\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
  assert.match(page, /return query\.range\(range\.from, range\.to\);/);
  assert.match(page, /<AdminListPager/);
  assert.match(page, /const currentPageHref = hrefForPage\(page\);/);
});
