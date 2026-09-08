import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const OWNER = "10000000-0000-4000-8000-000000000001";
const ORDER = "20000000-0000-4000-8000-000000000001";
const ITEM = "30000000-0000-4000-8000-000000000001";
type Harness = {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  RETURN: (request: Request) => Promise<Response>;
  state: { user: { id: string } | null; limited: boolean; failure: boolean; result: unknown };
  calls: Array<{ method: string; args: unknown[] }>;
};

// Run the real HTTP routes and streamed parser, replacing sessions, cache and
// domain operations. Ownership/transaction behavior is tested separately.
const bundle = build({
  stdin: { contents: `export {GET,POST} from './src/app/api/orders/route'; export {POST as RETURN} from './src/app/api/orders/return/route'; export {state,calls} from 'orders-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "orders-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(orders-fixture|@\/lib\/supabase\/(?:admin|server|server-user)|@\/lib\/(?:submission-orders|request-rate-limit|dashboard-status|url)|next\/cache)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
      const shared = `import {state,calls} from 'orders-fixture';`;
      const modules: Record<string, string> = {
        "orders-fixture": `export const state={user:{id:'${OWNER}'},limited:false,failure:false,result:{ok:true,submissionIds:['${ITEM}']}}; export const calls=[];`,
        "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({});`,
        "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>{calls.push({method:'auth',args:[]});return {};};`,
        "@/lib/supabase/server-user": `${shared} export const getServerSessionUser=async()=>state.user;`,
        "@/lib/submission-orders": `${shared} export const listSubmissionOrders=async(_db,...args)=>{calls.push({method:'list',args});if(state.failure)throw Error('private database error');return {orders:[],nextOffset:null};}; export const returnSubmissionOrderToCart=async(_db,...args)=>{calls.push({method:'return',args});if(state.failure)throw Error('private database error');return state.result;};`,
        "@/lib/request-rate-limit": `${shared} export const getRequestIdentifier=()=> 'test-ip'; export const consumeRateLimit=(...args)=>{calls.push({method:'rate',args});return {allowed:!state.limited,retryAfterSeconds:90};};`,
        "@/lib/dashboard-status": `${shared} export const clearDashboardStatusCache=(...args)=>calls.push({method:'clear',args});`,
        "next/cache": `${shared} export const revalidatePath=(...args)=>calls.push({method:'revalidate',args});`,
        "@/lib/url": `export const getBaseUrl=()=> 'https://glit-b1yn.onrender.com';`,
      };
      return { loader: "js", contents: modules[path] };
    });
  } }],
});
async function harness() {
  const result = await bundle; const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://onside.test/api/orders", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://onside.test", ...headers }, body: JSON.stringify(body),
});
const privileged = (h: Harness) => h.calls.filter(call => ["auth", "list", "return"].includes(call.method));

test("order reads use authenticated identity and private responses; guests supply exact credential maps", async () => {
  const h = await harness();
  const member = await h.GET(new Request("https://onside.test/api/orders?offset=30"));
  assert.equal(member.status, 200); assert.equal(member.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(h.calls.find(call => call.method === "list")?.args, [{ userId: OWNER, guestTokensBySubmissionId: {} }, 30]);
  h.state.user = null; h.calls.length = 0;
  assert.equal((await h.GET(new Request("https://onside.test/api/orders"))).status, 401);
  assert.equal(h.calls.some(call => call.method === "list"), false);
  const tokens = { [ITEM]: "guest-private-token" };
  const guest = await h.POST(post({ guestTokensBySubmissionId: tokens }));
  assert.equal(guest.status, 200);
  assert.deepEqual(h.calls.find(call => call.method === "list")?.args, [{ userId: null, guestTokensBySubmissionId: tokens }, 0]);
});

test("order routes reject oversized, malformed and identity-injecting input before privileged access", async () => {
  const h = await harness();
  for (const body of [null, { userId: OWNER }, { offset: -1 }, { offset: 1.5 }, { guestTokensBySubmissionId: { invalid: "guest-token" } }, { guestTokensBySubmissionId: { [ITEM]: " bad-token" } }]) {
    h.calls.length = 0; assert.equal((await h.POST(post(body))).status, 400); assert.equal(privileged(h).length, 0);
  }
  for (const route of [h.POST, h.RETURN]) {
    h.calls.length = 0;
    const body = JSON.stringify({ orderId: ORDER }) + " ".repeat(32768);
    const response = await route(new Request("https://onside.test/api/orders", { method: "POST", body, headers: { "content-length": "1" } }));
    assert.equal(response.status, 413); assert.equal(privileged(h).length, 0);
  }
  for (const body of [{}, { orderId: "invalid" }, { orderId: ORDER, userId: OWNER }]) {
    h.calls.length = 0; assert.equal((await h.RETURN(post(body))).status, 400); assert.equal(privileged(h).length, 0);
  }
});

test("order return rejects foreign origins and honors the configured public Render origin", async () => {
  const h = await harness();
  const foreignHeaders: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { origin: "https://onside.test", "sec-fetch-site": "cross-site" }, { origin: "null", "x-forwarded-host": "onside.test" }];
  for (const headers of foreignHeaders) {
    h.calls.length = 0; assert.equal((await h.RETURN(post({ orderId: ORDER }, headers))).status, 403); assert.equal(privileged(h).length, 0);
  }
  const response = await h.RETURN(new Request("http://localhost:10000/api/orders/return", { method: "POST", headers: { origin: "https://glit-b1yn.onrender.com" }, body: JSON.stringify({ orderId: ORDER }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls.find(call => call.method === "return")?.args, [ORDER, { userId: OWNER, guestTokensBySubmissionId: {} }]);
  const paths = h.calls.filter(call => call.method === "revalidate").map(call => call.args[0]);
  for (const path of ["/mypage/cart", "/mypage/orders", "/en/mypage/orders", `/mypage/submissions/${ITEM}`]) assert.ok(paths.includes(path));
});

test("rate limits precede sessions and preserve Retry-After, with stricter mutation limits", async () => {
  const h = await harness(); h.state.limited = true;
  for (const [route, limit] of [[h.POST, 120], [h.RETURN, 20]] as const) {
    h.calls.length = 0; const response = await route(post({ orderId: ORDER }));
    assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "90"); assert.equal(privileged(h).length, 0);
    assert.equal((h.calls[0].args[0] as { limit: number }).limit, limit);
  }
});

test("return conflicts are preserved and infrastructure errors do not leak sensitive details", async () => {
  const h = await harness(); h.state.result = { ok: false, status: 409, error: "주문 상태가 변경되었습니다." };
  assert.equal((await h.RETURN(post({ orderId: ORDER }))).status, 409);
  assert.equal(h.calls.some(call => call.method === "revalidate"), false);
  h.state.failure = true;
  for (const route of [h.POST, h.RETURN]) {
    const response = await route(post(route === h.POST ? {} : { orderId: ORDER }));
    assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private database error/);
  }
});
