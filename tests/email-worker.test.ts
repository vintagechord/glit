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
        "@/lib/email-outbox": "import {state,calls} from 'worker-fixture';export async function drainEmailOutbox(options){calls.push('drain');if(state.drainError)throw Error('fixture');return{claimed:1,accepted:1,retry:0,uncertain:0,failed:0,expired:0}}",
        "@/lib/payments/notification-events": "import {calls} from 'worker-fixture';export async function drainPaidSubmissionNotifications(){calls.push('receipts');return {claimed:1,recorded:1,retry:0}}",
        "@/lib/request-rate-limit": "export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';",
      } as Record<string, string>)[path] }));
    } }],
  });
  const bundled = { exports: {} as { POST: (r: Request) => Promise<Response>; state: { authorized: boolean; rpcError: boolean; drainError: boolean }; calls: unknown[] } };
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
  assert.equal((await api.POST(request("a".repeat(64)))).status, 200);
  assert.ok(api.calls.includes("drain"));
  assert.ok(api.calls.includes("receipts"));
  api.state.drainError = true;
  assert.equal((await api.POST(request("a".repeat(64)))).status, 503);
  assert.ok(api.calls.some(v => typeof v === "object" && v !== null && "last_error" in v && v.last_error === true));
});
