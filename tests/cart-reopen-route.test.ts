import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
const FIRST = "20000000-0000-4000-8000-000000000001";
const SECOND = "20000000-0000-4000-8000-000000000002";
const FIRST_TOKEN = "first-guest-private-token";
const SECOND_TOKEN = "second-guest-private-token";

type Row = Record<string, unknown>;
type Call = {
  method: string;
  table?: string;
  name?: string;
  args?: Row;
  input?: Row;
  operations?: { method: string; args: unknown[] }[];
};
type Harness = {
  POST: (request: Request) => Promise<Response>;
  state: {
    user: { id: string } | null;
    limited: boolean;
    rows: Row[];
    queryError: { code: string; message: string } | null;
    rpcError: { code: string; message: string } | null;
    rpcRows: Row[] | null;
  };
  calls: Call[];
};

// Exercise the actual route, request parser and ownership helper. The fixture
// replaces infrastructure only; authorization and RPC result handling are real.
const bundle = build({
  stdin: {
    contents: `export { POST } from './src/app/api/cart/reopen/route'; export { state, calls } from 'cart-reopen-fixture';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
  plugins: [{ name: "cart-reopen-infrastructure", setup(plugin) {
    plugin.onResolve({ filter: /^(cart-reopen-fixture|@\/lib\/supabase\/(?:admin|server|server-user)|@\/lib\/request-rate-limit|@\/lib\/dashboard-status|next\/cache)$/ }, args => ({ path: args.path, namespace: "cart-reopen-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "cart-reopen-fixture" }, ({ path }) => {
      const shared = `import { state, calls, client } from 'cart-reopen-fixture';`;
      const files: Record<string, string> = {
        "cart-reopen-fixture": `
          export const state={user:{id:'${OWNER}'},limited:false,rows:[],queryError:null,rpcError:null,rpcRows:null};
          export const calls=[];
          function query(table){
            const operations=[];const q={};
            for(const method of ['select','in','eq','is'])q[method]=(...args)=>{operations.push({method,args});return q;};
            q.then=(resolve,reject)=>{
              calls.push({method:'query',table,operations:structuredClone(operations)});
              if(state.queryError)return Promise.resolve({data:null,error:state.queryError}).then(resolve,reject);
              let rows=[...state.rows];
              for(const op of operations){
                const [key,value]=op.args;
                if(op.method==='eq')rows=rows.filter(row=>row[key]===value);
                if(op.method==='is')rows=rows.filter(row=>value===null?row[key]==null:row[key]===value);
                if(op.method==='in')rows=rows.filter(row=>value.includes(row[key]));
              }
              return Promise.resolve({data:structuredClone(rows),error:null}).then(resolve,reject);
            };
            return q;
          }
          export const client={from:query,rpc:async(name,args)=>{
            calls.push({method:'rpc',name,args:structuredClone(args)});
            return {data:state.rpcError?null:(state.rpcRows??args.p_submission_ids.map(submission_id=>({submission_id}))),error:state.rpcError};
          }};`,
        "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>{calls.push({method:'admin'});return client;};`,
        "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>{calls.push({method:'server'});return {auth:{getUser:async()=>{calls.push({method:'auth'});return {data:{user:state.user},error:null};}}};};`,
        "@/lib/supabase/server-user": `${shared} export const getServerSessionUser=async()=>{calls.push({method:'auth'});return state.user;};`,
        "@/lib/request-rate-limit": `${shared} export const getRequestIdentifier=()=> 'fixture-ip'; export const consumeRateLimit=input=>{calls.push({method:'rate',input});return {allowed:!state.limited,retryAfterSeconds:120};};`,
        "@/lib/dashboard-status": `${shared} export const clearDashboardStatusCache=userId=>{calls.push({method:'clear-cache',input:{userId}});};`,
        "next/cache": `${shared} export const revalidatePath=path=>{calls.push({method:'revalidate',input:{path}});};`,
      };
      return { loader: "js", contents: files[path] };
    });
  } }],
});

async function harness() {
  const result = await bundle;
  const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

const rawRequest = (body: string, headers: Record<string, string> = {}) => new Request("https://onside.test/api/cart/reopen", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://onside.test", ...headers },
  body,
});
const request = (body: unknown) => rawRequest(JSON.stringify(body));
const row = (id = FIRST, userId: string | null = OWNER, guestToken: string | null = null): Row => ({
  id, user_id: userId, guest_token: guestToken, status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING", user_deleted_at: null,
});
const mutations = (h: Harness) => h.calls.filter(call => call.method === "rpc");
const authOrDatabaseCalls = (h: Harness) => h.calls.filter(call => ["server", "auth", "admin", "query", "rpc"].includes(call.method));

test("reopen rejects malformed IDs, strict unknown keys and unrelated guest credentials before authentication or database access", async () => {
  const h = await harness();
  const invalid = [
    null,
    {},
    { submissionIds: [] },
    { submissionIds: ["not-a-uuid"] },
    { submissionIds: Array.from({ length: 101 }, () => FIRST) },
    { submissionIds: [FIRST], userId: OTHER_OWNER },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { [SECOND]: SECOND_TOKEN } },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { [FIRST]: "short" } },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { [FIRST]: ` ${FIRST_TOKEN}` } },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { [FIRST]: `${FIRST_TOKEN}\n` } },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { [FIRST]: `guest\u0000token` } },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { [FIRST]: "x".repeat(121) } },
    { submissionIds: [FIRST], guestTokensBySubmissionId: { invalid: FIRST_TOKEN } },
  ];
  for (const body of invalid) {
    h.calls.length = 0;
    const response = await h.POST(request(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(authOrDatabaseCalls(h).length, 0, "invalid input must not trigger privileged infrastructure");
  }
  h.calls.length = 0;
  assert.equal((await h.POST(rawRequest('{"submissionIds":'))).status, 400);
  assert.equal(authOrDatabaseCalls(h).length, 0);
});

test("reopen enforces the 32 KiB streamed body limit even with missing or forged content length", async () => {
  const h = await harness();
  const oversized = JSON.stringify({ submissionIds: [FIRST] }) + " ".repeat(32 * 1024);
  const headerCases: Record<string, string>[] = [{}, { "content-length": "1" }, { "content-length": String(Buffer.byteLength(oversized)) }];
  for (const headers of headerCases) {
    h.calls.length = 0;
    const response = await h.POST(rawRequest(oversized, headers));
    assert.equal(response.status, 413);
    assert.equal(authOrDatabaseCalls(h).length, 0);
  }
});

test("reopen rate limits to 20 requests per 15 minutes before authentication or writes", async () => {
  const h = await harness();
  h.state.limited = true;
  const response = await h.POST(request({ submissionIds: [FIRST] }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "120");
  assert.equal(authOrDatabaseCalls(h).length, 0);
  const rate = h.calls.find(call => call.method === "rate")?.input;
  assert.equal(rate?.limit, 20);
  assert.equal(rate?.windowMs, 15 * 60 * 1000);
});

test("reopen only passes verified member IDs and the authenticated owner to the atomic RPC", async () => {
  const h = await harness();
  h.state.rows = [row(), row(SECOND)];
  const response = await h.POST(request({ submissionIds: [FIRST, SECOND] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, reopenedIds: [FIRST, SECOND] });
  assert.deepEqual(mutations(h), [{ method: "rpc", name: "reopen_submission_bank_payment", args: {
    p_submission_ids: [FIRST, SECOND], p_user_id: OWNER, p_guest_tokens_by_submission_id: {},
  } }]);
  const query = h.calls.find(call => call.method === "query");
  assert.equal(query?.table, "submissions");
  assert.ok(query.operations?.some(op => op.method === "eq" && op.args[0] === "user_id" && op.args[1] === OWNER));
});

test("reopen rejects missing or foreign member submissions without a partial RPC or guest-token bypass", async () => {
  const h = await harness();
  h.state.rows = [row(), row(SECOND, OTHER_OWNER, SECOND_TOKEN)];
  for (const guestTokensBySubmissionId of [undefined, { [SECOND]: SECOND_TOKEN }]) {
    h.calls.length = 0;
    const response = await h.POST(request({ submissionIds: [FIRST, SECOND], guestTokensBySubmissionId }));
    assert.equal(response.status, 403);
    assert.equal(mutations(h).length, 0);
    const body = await response.text();
    assert.doesNotMatch(body, new RegExp(`${OTHER_OWNER}|${SECOND_TOKEN}`));
  }
  h.state.rows = [row()];
  h.calls.length = 0;
  assert.equal((await h.POST(request({ submissionIds: [FIRST, SECOND] }))).status, 403);
  assert.equal(mutations(h).length, 0);
});

test("guest reopening requires each token to match its exact submission ID", async () => {
  const h = await harness();
  h.state.user = null;
  h.state.rows = [row(FIRST, null, FIRST_TOKEN), row(SECOND, null, SECOND_TOKEN)];
  const guestTokensBySubmissionId = { [FIRST]: FIRST_TOKEN, [SECOND]: SECOND_TOKEN };
  const response = await h.POST(request({ submissionIds: [FIRST, SECOND], guestTokensBySubmissionId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, reopenedIds: [FIRST, SECOND] });
  assert.deepEqual(mutations(h)[0]?.args, {
    p_submission_ids: [FIRST, SECOND], p_user_id: null, p_guest_tokens_by_submission_id: guestTokensBySubmissionId,
  });
  for (const tokens of [{ [FIRST]: SECOND_TOKEN, [SECOND]: FIRST_TOKEN }, { [FIRST]: FIRST_TOKEN }, {}]) {
    h.calls.length = 0;
    const rejected = await h.POST(request({ submissionIds: [FIRST, SECOND], guestTokensBySubmissionId: tokens }));
    assert.ok([401, 403].includes(rejected.status));
    assert.equal(mutations(h).length, 0, "neither a token set nor a partial match authorizes the complete batch");
  }
});

test("reopen accepts configured Render origins without trusting forwarded host headers", async () => {
  const h = await harness();
  h.state.rows = [row()];
  const origin = "https://glit-b1yn.onrender.com";
  const envKeys = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL", "APP_URL"] as const;
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const internalRequest = (headers: Record<string, string>) => new Request("http://localhost:10000/api/cart/reopen", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ submissionIds: [FIRST] }),
  });
  try {
    for (const configuredKey of envKeys) {
      for (const key of envKeys) delete process.env[key];
      process.env[configuredKey] = origin;
      h.calls.length = 0;
      const allowed = await h.POST(internalRequest({ origin, "sec-fetch-site": "same-origin" }));
      assert.equal(allowed.status, 200, `${configuredKey} must support the public origin behind Render`);
      assert.equal(mutations(h).length, 1);

      const rejectedHeaders: Record<string, string>[] = [
        { origin: "https://foreign.invalid" },
        { origin: "https://foreign.invalid", "x-forwarded-host": "foreign.invalid", "x-forwarded-proto": "https" },
        { origin: `${origin}.foreign.invalid` },
        { origin: "null" },
        { origin, "sec-fetch-site": "cross-site" },
        { "sec-fetch-site": "cross-site" },
      ];
      for (const headers of rejectedHeaders) {
        h.calls.length = 0;
        const rejected = await h.POST(internalRequest(headers));
        assert.equal(rejected.status, 403);
        assert.equal(authOrDatabaseCalls(h).length, 0, "cross-site requests must stop before auth or database access");
      }

      h.calls.length = 0;
      assert.equal((await h.POST(internalRequest({}))).status, 200, "requests without Origin keep existing support");
      assert.equal(mutations(h).length, 1);
    }
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("reopen accepts the full allowed batch and deduplicates repeated submissions before its atomic RPC", async () => {
  const h = await harness();
  const ids = Array.from({ length: 100 }, (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  h.state.rows = ids.map(id => row(id));
  let response = await h.POST(request({ submissionIds: ids }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, reopenedIds: ids });
  assert.equal(mutations(h).length, 1);

  h.calls.length = 0;
  h.state.rows = [row()];
  const json = JSON.stringify({ submissionIds: [FIRST, FIRST] });
  response = await h.POST(rawRequest(json.padEnd(32 * 1024, " ")));
  assert.equal(response.status, 200, "the exact 32 KiB boundary is allowed");
  assert.deepEqual(await response.json(), { ok: true, reopenedIds: [FIRST] });
  assert.deepEqual(mutations(h)[0]?.args?.p_submission_ids, [FIRST]);
});

test("reopen maps ownership and payment-state race failures without disclosing database details or invalidating caches", async (t) => {
  const h = await harness();
  h.state.rows = [row()];
  t.mock.method(console, "error", () => undefined);
  for (const [code, message, status] of [
    ["42501", "private-owner-denied", 403],
    ["P0002", "private-missing-row", 403],
    ["55000", "ALBUM_GROUP_INCOMPLETE private-group", 409],
    ["55000", "private-payment-already-completed", 409],
    ["XX000", "private-database-secret", 500],
  ] as const) {
    h.calls.length = 0;
    h.state.rpcError = { code, message };
    const response = await h.POST(request({ submissionIds: [FIRST] }));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.ok, undefined);
    assert.doesNotMatch(body.error, /private-|ALBUM_GROUP_INCOMPLETE|XX000/);
    assert.equal(mutations(h).length, 1);
    assert.ok(!h.calls.some(call => ["clear-cache", "revalidate"].includes(call.method)));
  }
});

test("reopen never reports success for a partial or unrelated transaction result", async () => {
  const h = await harness();
  h.state.rows = [row(), row(SECOND)];
  for (const rpcRows of [[], [{ submission_id: FIRST }], [{ submission_id: FIRST }, { submission_id: OTHER_OWNER }]]) {
    h.calls.length = 0;
    h.state.rpcRows = rpcRows;
    const response = await h.POST(request({ submissionIds: [FIRST, SECOND] }));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, undefined);
    assert.equal(body.reopenedIds, undefined);
    assert.ok(!h.calls.some(call => ["clear-cache", "revalidate"].includes(call.method)));
  }
});

test("reopen stops on an ownership-query failure before any payment mutation", async () => {
  const h = await harness();
  h.state.queryError = { code: "XX000", message: "private database credentials" };
  const response = await h.POST(request({ submissionIds: [FIRST] }));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private database credentials|XX000/);
  assert.equal(mutations(h).length, 0);
});
