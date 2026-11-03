import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("scheduled mail worker requires its own credential, rejects outage and records drain results", async () => {
  const bundle = await build({ stdin: { contents: "export * from './src/app/api/internal/email-outbox/route'; export {state,calls} from 'worker-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "worker-fixture", setup(p) {
      p.onResolve({ filter: /^(worker-fixture|@\/lib\/(supabase\/admin|email-outbox|payments\/notification-events|request-rate-limit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      p.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: ({
        "worker-fixture": "export const state={authorized:false,rpcError:false,drainError:false};export const calls=[];",
        "@/lib/supabase/admin": "import {state,calls} from 'worker-fixture'; export const createAdminClient=()=>({rpc:async(name,args)=>{calls.push(name);return{data:state.authorized,error:state.rpcError?{}:null}},from:()=>({update:values=>({eq:async()=>{calls.push(values);return{error:null}}})})});",
        "@/lib/email-outbox": "import {state,calls} from 'worker-fixture';export async function drainEmailOutbox(options){calls.push('drain');state.options=options;if(state.drainError)throw Error('fixture');return{claimed:1,accepted:1,retry:0,uncertain:0,failed:0,expired:0}}",
        "@/lib/payments/notification-events": "import {calls} from 'worker-fixture';export async function drainPaidSubmissionNotifications(){calls.push('receipts');return {claimed:1,recorded:1,retry:0}}",
        "@/lib/request-rate-limit": "export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';",
      } as Record<string, string>)[path] }));
    } }],
  });
  const bundled = { exports: {} as { POST: (r: Request) => Promise<Response>; maxDuration: number; state: { authorized: boolean; rpcError: boolean; drainError: boolean; options?: { limit: number; batchSize: number; deadline: number } }; calls: unknown[] } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const api = bundled.exports;
  const request = (token?: string) => new Request("https://example.invalid/api/internal/email-outbox", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await api.POST(request())).status, 401);
  assert.equal(api.calls.length, 0);
  assert.equal((await api.POST(request("a".repeat(64)))).status, 401);
  assert.ok(!api.calls.includes("drain"));
  api.state.rpcError = true;
  assert.equal((await api.POST(request("a".repeat(64)))).status, 503);
  assert.ok(!api.calls.includes("drain"));
  api.state.rpcError = false; api.state.authorized = true;
  const before = Date.now();
  assert.equal((await api.POST(request("a".repeat(64)))).status, 200);
  assert.ok(api.calls.includes("drain"));
  assert.ok(api.calls.includes("receipts"));
  // The drain gets the function's own deadline, leaving room for the heartbeat.
  assert.equal(api.maxDuration, 300);
  assert.equal(api.state.options?.limit, 9);
  assert.equal(api.state.options?.batchSize, 3);
  const remaining = api.state.options!.deadline - before;
  assert.ok(remaining > 280_000 && remaining <= 285_000, String(remaining));
  api.state.drainError = true;
  assert.equal((await api.POST(request("a".repeat(64)))).status, 503);
  assert.ok(api.calls.some(v => typeof v === "object" && v !== null && "last_error" in v && v.last_error === true));
});

test("the scheduler token check compares digests, not the token text", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const latest = readdirSync(dir).filter(name => name.endsWith(".sql")).sort()
    .filter(name => /create or replace function public\.authorize_email_worker\(/.test(readFileSync(new URL(name, dir), "utf8"))).at(-1);
  assert.equal(latest, "20261103160100_email_worker_token_digest.sql");
  const sql = readFileSync(new URL(latest!, dir), "utf8");
  assert.match(sql, /extensions\.digest\(token, 'sha256'\) = extensions\.digest\(p_token, 'sha256'\)/);
  assert.doesNotMatch(sql, /token = p_token/);
  assert.match(sql, /security invoker set search_path = ''/);
  assert.match(sql, /revoke all on function public\.authorize_email_worker\(text\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.authorize_email_worker\(text\) to service_role;/);
});
