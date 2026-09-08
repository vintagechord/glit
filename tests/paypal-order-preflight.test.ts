import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const bundle = build({
  stdin: { contents: `export {createPayPalOrderForSubmission} from './src/lib/payments/paypal';export {state,calls} from 'paypal-preflight-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  define: { "process.env.PAYPAL_CLIENT_ID": '"fixture-client"', "process.env.PAYPAL_CLIENT_SECRET": '"fixture-secret"' },
  plugins: [{ name: "paypal-preflight-fixture", setup(plugin) {
    const files: Record<string, string> = {
      "paypal-preflight-fixture": `export const state={row:{id:'20000000-0000-4000-8000-000000000001',user_id:'member-owner',status:'SUBMITTED',payment_status:'UNPAID',current_order_id:'active-order',payment_provider:'paypal',payment_amount:79,payment_currency:'USD'}};export const calls=[];`,
      "@/lib/supabase/server": `export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'member-owner'}}})}});`,
      "@/lib/supabase/admin": `import {state,calls} from 'paypal-preflight-fixture';export const createAdminClient=()=>({from(){const filters=[];const q={select(columns){calls.push({method:'select',columns});return q;},eq(key,value){filters.push([key,value]);return q;},is(key,value){filters.push([key,value]);return q;},maybeSingle:async()=>({data:filters.every(([key,value])=>state.row[key]===value)?state.row:null,error:null})};return q;}});`,
      "@/lib/submission-payment-files": `import {calls} from 'paypal-preflight-fixture';export const validateReleasedAlbumPaymentFiles=async()=>{calls.push({method:'media'});return 'fixture stop before gateway';};`,
    };
    plugin.onResolve({ filter: /^(paypal-preflight-fixture|@\/lib\/)/ }, args => files[args.path] ? ({ path: args.path, namespace: "paypal-preflight-fixture" }) : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "paypal-preflight-fixture" }, ({ path }) => ({ loader: "js", contents: files[path] }));
  } }],
});

test("PayPal creates no external order for a submission already attached to any order", async (t) => {
  const result = await bundle;
  type Harness = {
    createPayPalOrderForSubmission: typeof import("../src/lib/payments/paypal").createPayPalOrderForSubmission;
    state: { row: { id: string; current_order_id: string | null; payment_status: string } };
    calls: Array<{ method: string; columns?: string }>;
  };
  const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const h = loaded.exports;
  t.mock.method(globalThis, "fetch", async () => { assert.fail("preflight must never contact a payment provider"); });
  for (const paymentStatus of ["UNPAID", "PAYMENT_PENDING", "PAID"]) {
    h.state.row.payment_status = paymentStatus;
    const response = await h.createPayPalOrderForSubmission({ submissionId: h.state.row.id, request: new Request("https://onside.test/api/paypal/orders") });
    assert.ok(response.error);
    assert.equal(h.calls.some(call => call.method === "media"), false);
    assert.ok(h.calls.filter(call => call.method === "select").every(call => call.columns?.includes("current_order_id")));
  }
  h.state.row.current_order_id = null;
  h.state.row.payment_status = "UNPAID";
  const allowed = await h.createPayPalOrderForSubmission({ submissionId: h.state.row.id, request: new Request("https://onside.test/api/paypal/orders") });
  assert.equal(allowed.error, "fixture stop before gateway");
  assert.equal(h.calls.filter(call => call.method === "media").length, 1);
});
