import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Call = { kind: "rpc" | "query"; name: string; ops: unknown[][] };
type Fixture = {
  default: (props: { searchParams?: Promise<Record<string, string>> }) => Promise<ReactElement>;
  state: { profiles: Array<Record<string, unknown>>; count: number; emailMatches: string[]; rpcError: boolean; accountsMissing: boolean; providers: Record<string, string[]> };
  calls: Call[];
};

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: "export {default} from './src/app/admin/users/page'; export {state,calls} from 'users-fixture';", resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false, jsx: "automatic",
    plugins: [{ name: "users-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(users-fixture|@\/lib\/supabase\/admin|@\/lib\/admin\/page-auth|next\/link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", resolveDir: process.cwd(), contents: {
        "users-fixture": `export const calls=[]; export const state={profiles:[],count:0,emailMatches:[],rpcError:false,accountsMissing:false,providers:{}};`,
        "@/lib/admin/page-auth": "export const requireAdminPage=async()=>({id:'admin'});",
        "next/link": "import {createElement} from 'react'; export default function Link({href,children,...rest}){return createElement('a',{href,...rest},children);}",
        "@/lib/supabase/admin": `import {state,calls} from 'users-fixture';
          export const createAdminClient=()=>({
            rpc:async(name,args)=>{calls.push({kind:'rpc',name,ops:[[args]]});if(state.rpcError)return {data:null,error:{message:'missing function'}};
              if(name==='admin_search_auth_user_ids')return {data:state.emailMatches.map(user_id=>({user_id})),error:null};
              if(name==='admin_auth_user_accounts'){if(state.accountsMissing)return {data:null,error:{message:'function not found'}};
                return {data:(args.p_user_ids||[]).map(user_id=>{const providers=state.providers[user_id]||['email'];return {user_id,email:providers[0]==='email'||providers[0]==='google'?user_id+'@example.invalid':null,signup_provider:providers[0],providers};}),error:null};}
              return {data:(args.p_user_ids||[]).map(user_id=>({user_id,email:user_id+'@example.invalid'})),error:null};},
            from(table){const ops=[];const call={kind:'query',name:table,ops};calls.push(call);const q={
              select(...a){ops.push(['select',...a]);return q},order(...a){ops.push(['order',...a]);return q},or(...a){ops.push(['or',...a]);return q},
              async range(...a){ops.push(['range',...a]);return {data:state.profiles,error:null,count:state.count}}};return q;},
          });`,
      }[path]! }));
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

const memberId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

test("admin users page pages profiles and asks for exactly the shown members' emails", async () => {
  const page = await fixture();
  page.state.profiles = [1, 2].map(index => ({ user_id: memberId(index), name: `회원${index}`, company: null, phone: null, created_at: "2026-11-01T00:00:00Z", updated_at: null }));
  page.state.count = 1234;
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ page: "3" }) }));
  const profiles = page.calls.find(call => call.name === "profiles")!;
  assert.deepEqual(profiles.ops.find(op => op[0] === "range"), ["range", 100, 149]);
  assert.deepEqual(profiles.ops.filter(op => op[0] === "order"), [["order", "created_at", { ascending: false }], ["order", "user_id", { ascending: false }]]);
  assert.deepEqual(profiles.ops.find(op => op[0] === "select")?.[2], { count: "exact" });
  const accounts = page.calls.find(call => call.name === "admin_auth_user_accounts")!;
  assert.deepEqual(accounts.ops[0][0], { p_user_ids: [memberId(1), memberId(2)] });
  assert.equal(page.calls.some(call => call.name === "admin_auth_user_emails"), false);
  assert.match(html, new RegExp(`${memberId(2)}@example\\.invalid`));
  assert.match(html, /총 1,234명/);
  assert.match(html, /3 \/ 25/);
  assert.match(html, /href="\/admin\/users\?page=4"/);
  assert.equal(page.calls.some(call => call.name === "admin_search_auth_user_ids"), false);
});

test("search matches email through the auth lookup and name, company or phone in profiles", async () => {
  const page = await fixture();
  page.state.emailMatches = [memberId(7), "not-a-uuid"];
  page.state.count = 1;
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ q: "kim, (lee)" }) }));
  const search = page.calls.find(call => call.name === "admin_search_auth_user_ids")!;
  assert.deepEqual(search.ops[0][0], { p_query: "kim, (lee)", p_limit: 100 });
  const filter = page.calls.find(call => call.name === "profiles")!.ops.find(op => op[0] === "or")?.[1];
  assert.equal(filter, `name.ilike."%kim, (lee)%",company.ilike."%kim, (lee)%",phone.ilike."%kim, (lee)%",user_id.in.(${memberId(7)})`);
  assert.match(html, /value="kim, \(lee\)"/);
  assert.match(html, /검색 결과가 없습니다/);

  const degraded = await fixture();
  degraded.state.rpcError = true;
  const fallback = renderToStaticMarkup(await degraded.default({ searchParams: Promise.resolve({ q: "kim" }) }));
  assert.match(fallback, /이메일 검색을 사용할 수 없어/);
  assert.doesNotMatch(String(degraded.calls.find(call => call.name === "profiles")!.ops.find(op => op[0] === "or")?.[1]), /user_id\.in/);
});

test("the page no longer lists auth users wholesale and the lookups stay service-role only", () => {
  const source = readFileSync("src/app/admin/users/page.tsx", "utf8");
  assert.doesNotMatch(source, /listUsers|\.limit\(200\)/);
  const migration = readFileSync("supabase/migrations/20261103160300_admin_user_directory.sql", "utf8");
  for (const fn of ["admin_auth_user_emails(uuid[])", "admin_search_auth_user_ids(text, integer)"]) {
    assert.ok(migration.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(migration.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  assert.match(migration, /security definer set search_path = ''/);
  assert.match(migration, /replace\(replace\(replace\(btrim\(p_query\), '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\)/);
});

test("each member shows the sign-up method and other linked sign-in methods", async () => {
  const page = await fixture();
  page.state.profiles = [1, 2, 3, 4].map(index => ({ user_id: memberId(index), name: `회원${index}`, company: null, phone: null, created_at: "2026-11-01T00:00:00Z", updated_at: null }));
  page.state.count = 4;
  page.state.providers = { [memberId(1)]: ["email"], [memberId(2)]: ["custom:naver"], [memberId(3)]: ["kakao", "google"], [memberId(4)]: ["google"] };
  const html = renderToStaticMarkup(await page.default({}));
  assert.match(html, /<th[^>]*>가입 방법<\/th>/);
  const rows = html.split("<tr").slice(2);
  assert.match(rows[0], />이메일<\/span>/);
  assert.match(rows[1], />네이버<\/span>/); assert.match(rows[1], /제공처 이메일 없음/);
  assert.match(rows[2], />카카오<\/span>/); assert.match(rows[2], /\+ 연결 구글/);
  assert.match(rows[3], />구글<\/span>/); assert.match(rows[3], new RegExp(`${memberId(4)}@example\\.invalid`));
  assert.doesNotMatch(html, /custom:naver/);
});

test("before the sign-in method function is deployed the page falls back to emails only", async () => {
  const page = await fixture();
  page.state.profiles = [{ user_id: memberId(1), name: "회원", company: null, phone: null, created_at: null, updated_at: null }];
  page.state.count = 1;
  page.state.accountsMissing = true;
  const html = renderToStaticMarkup(await page.default({}));
  assert.ok(page.calls.some(call => call.name === "admin_auth_user_emails"));
  assert.match(html, new RegExp(`${memberId(1)}@example\\.invalid`));
  assert.match(html, /가입 방법 조회 기능이 아직 준비되지 않아/);
});
