import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const submissionId = "20000000-0000-4000-8000-000000000001";
const orderId = "fixture-paypal-order";
const bundle = build({
  stdin: { contents: "export {capturePayPalOrder} from './src/lib/payments/paypal';export {state,calls} from 'paypal-confirmation-fixture';", resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  define: { "process.env.PAYPAL_CLIENT_ID": '"fixture-client"', "process.env.PAYPAL_CLIENT_SECRET": '"fixture-secret"' },
  plugins: [{ name: "paypal-confirmation-fixture", setup(plugin) {
    const modules: Record<string, string> = {
      "paypal-confirmation-fixture": `export const calls=[];export const state={claim:'fresh',persistOk:true,noticeOk:true};`,
      "@/lib/supabase/server": "export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'fixture-member'}}})}});",
      "@/lib/supabase/admin": `import {state,calls} from 'paypal-confirmation-fixture';export const createAdminClient=()=>({rpc:async(name,input)=>{
        calls.push({name,input});
        if(name==='claim_paypal_submission_capture')return state.claim==='denied'?{error:{code:'42501'},data:null}:{error:null,data:[{expected_amount:79,expected_currency:'USD',already_approved:state.claim==='approved',already_processing:state.claim==='processing',capture_id:state.claim==='approved'?'fixture-capture':null}]};
        if(name==='approve_paypal_submission_payment')return state.persistOk?{error:null,data:[{capture_id:'fixture-capture'}]}:{error:{code:'40001'},data:null};
        if(name==='close_paypal_submission_payment')return {error:null,data:[{final_status:'FAILED'}]};
        throw new Error('Unexpected payment RPC');
      }});`,
      "@/lib/payments/notifications": `import {state,calls} from 'paypal-confirmation-fixture';export const sendPaidSubmissionNotificationsById=async input=>{calls.push({name:'notifications',input});return {ok:state.noticeOk};};`,
    };
    plugin.onResolve({ filter: /^(paypal-confirmation-fixture|@\/lib\/)/ }, args => modules[args.path] ? ({ path: args.path, namespace: "fixture" }) : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: modules[path], loader: "js" }));
  } }],
});
type Harness = {
  capturePayPalOrder: typeof import("../src/lib/payments/paypal").capturePayPalOrder;
  state: { claim: string; persistOk: boolean; noticeOk: boolean };
  calls: Array<{ name: string; input: Record<string, unknown> }>;
};
const harness = async () => {
  const built = await bundle;
  const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
};

test("PayPal notifies only after committed approval and a verified replay retries registration without another capture", async t => {
  for (const scenario of ["fresh", "approved", "processing", "denied", "persist-failed", "notice-pending", "amount-mismatch", "declined"]) {
    const h = await harness();
    h.state.claim = ["approved", "processing", "denied"].includes(scenario) ? scenario : "fresh";
    h.state.persistOk = scenario !== "persist-failed";
    h.state.noticeOk = scenario !== "notice-pending";
    const gatewayCalls: string[] = [];
    t.mock.method(console, "error", () => undefined);
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      const url = String(input); gatewayCalls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "fixture-token" });
      assert.match(url, /\/v2\/checkout\/orders\/fixture-paypal-order\/capture$/);
      return Response.json({ id: orderId, status: scenario === "declined" ? "DECLINED" : "COMPLETED", purchase_units: [{ reference_id: submissionId, payments: { captures: [{ id: "fixture-capture", status: scenario === "declined" ? "DECLINED" : "COMPLETED", amount: { value: scenario === "amount-mismatch" ? "80.00" : "79.00", currency_code: "USD" } }] } }] });
    });
    const result = await h.capturePayPalOrder({ submissionId, orderId });
    const notice = h.calls.filter(call => call.name === "notifications");
    const shouldNotify = ["fresh", "approved", "notice-pending"].includes(scenario);
    assert.equal(notice.length, shouldNotify ? 1 : 0, scenario);
    if (shouldNotify) {
      assert.equal(result.ok, true, scenario);
      assert.deepEqual(notice[0].input, { submissionId, paymentKey: `paypal:${orderId}` });
    } else assert.ok(result.error, scenario);
    if (scenario === "approved") {
      assert.equal(gatewayCalls.length, 0);
      assert.deepEqual(h.calls.map(call => call.name), ["claim_paypal_submission_capture", "notifications"]);
    }
    if (scenario === "fresh" || scenario === "notice-pending") {
      assert.deepEqual(h.calls.map(call => call.name), ["claim_paypal_submission_capture", "approve_paypal_submission_payment", "notifications"]);
    }
    t.mock.restoreAll();
  }
});
