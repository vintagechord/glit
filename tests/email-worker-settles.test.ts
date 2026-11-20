import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

// A failing payment-receipt drain made the mail worker answer 503 while the
// outbox drain was still sending. Work after the response is not guaranteed
// on Vercel, so a frozen send outlived its lease and the row ended up
// "uncertain", which is never retried automatically.

async function workerRoute() {
  const bundle = await build({ stdin: { contents: "export * from './src/app/api/internal/email-outbox/route'; export {state,calls} from 'worker-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "worker-fixture", setup(p) {
      p.onResolve({ filter: /^(worker-fixture|@\/lib\/(supabase\/admin|email-outbox|payments\/notification-events|request-rate-limit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      p.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: ({
        "worker-fixture": "export const state={};export const calls=[];",
        "@/lib/supabase/admin": "import {calls} from 'worker-fixture'; export const createAdminClient=()=>({rpc:async(name)=>{calls.push(name);return{data:true,error:null}},from:()=>({update:values=>({eq:async()=>{calls.push(values);return{error:null}}})})});",
        "@/lib/email-outbox": "import {calls} from 'worker-fixture';export async function drainEmailOutbox(){calls.push('drain-start');await new Promise(r=>setTimeout(r,200));calls.push('drain-finished');return{claimed:1,accepted:1,retry:0,uncertain:0,failed:0,expired:0}}",
        "@/lib/payments/notification-events": "import {calls} from 'worker-fixture';export async function drainPaidSubmissionNotifications(){calls.push('receipts-failed');throw Error('fixture gateway error')}",
        "@/lib/request-rate-limit": "export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';",
      } as Record<string, string>)[path] }));
    } }],
  });
  const loaded = { exports: {} as { POST: (r: Request) => Promise<Response>; calls: unknown[] } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

test("the mail worker answers only after the outbox drain has finished, even when receipts fail", async () => {
  const api = await workerRoute();
  const response = await api.POST(new Request("https://example.invalid/api/internal/email-outbox", { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(64)}` } }));
  assert.equal(response.status, 503);
  assert.ok(api.calls.includes("drain-finished"), "the response must wait for the sends in flight");
  assert.ok(api.calls.some(v => typeof v === "object" && v !== null && "last_error" in v && (v as { last_error: boolean }).last_error === true));
});

async function receiptDrain() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/payments/notification-events';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "receipt-fixture", setup(p) {
      p.onResolve({ filter: /^(?:@\/lib\/(supabase\/admin|email-delivery-mode)|\.\/notifications)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      p.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path.includes("email-delivery-mode") ? "export const getEmailDeliveryMode=()=> 'transactional'" : path.includes("supabase") ? "export const createAdminClient=()=>{throw Error('no live DB in tests')}" : "export async function sendPaidSubmissionNotificationsById(){throw Error('no live mail in tests')}" }));
    } }],
  });
  const loaded = { exports: {} as typeof import("../src/lib/payments/notification-events") };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

test("one receipt event whose acknowledgement fails does not abandon a sibling that is still sending", async () => {
  const { drainPaidSubmissionNotifications } = await receiptDrain();
  const events = ["fast", "slow"].map(submission_id => ({ submission_id, payment_key: `order:${submission_id}`, lease_token: `lease:${submission_id}` }));
  const finished: string[] = [];
  await assert.rejects(drainPaidSubmissionNotifications({
    limit: 2,
    store: {
      async claim() { return events; },
      async finish(event) {
        if (event.submission_id === "fast") throw Error("fixture acknowledgement outage");
        finished.push(event.submission_id);
        return true;
      },
    },
    async notify(input) {
      if (input.submissionId === "slow") await new Promise(r => setTimeout(r, 200));
      return { recorded: true, eligible: true, customer: null, admin: null };
    },
  }), /fixture acknowledgement outage/);
  assert.deepEqual(finished, ["slow"], "the slow event must be acknowledged before the drain reports the failure");
});
