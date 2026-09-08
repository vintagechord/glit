import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { build } from "esbuild";
import { NextRequest } from "next/server";

const ID = "20000000-0000-4000-8000-000000000001";
const ORDER = "onside-fixture-order";
const STATE = "30000000-0000-4000-8000-000000000001";
const fixtureSource = `
export const state={payment:{status:'REQUESTED',submission_id:'${ID}',amount_krw:49000,raw_response:{closeState:'${STATE}'},submission:{id:'${ID}',guest_token:null}},claim:'fresh',approval:{ok:true,data:{resultCode:'0000',MOID:'${ORDER}',TotPrice:'49000',tid:'fixture-tid',tstamp:'fixture-time',authSignature:'valid-signature'}},cancelOk:true,persistOk:true,throwApproval:false,wait:null,release:null};
export const calls=[];
`;
const handlerBundle = build({
  stdin: { contents: `export { handleInicisReturn } from './src/app/api/inicis/return/handler';export { state,calls } from 'approval-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  plugins: [{ name: "approval-fixture", setup(plugin) {
    const files: Record<string, string> = {
      "approval-fixture": fixtureSource,
      "@/lib/inicis/api": `import {state,calls} from 'approval-fixture';export const isInicisSuccessCode=code=>['00','0000'].includes(String(code));export const requestStdPayApproval=async()=>{calls.push({method:'gateway'});if(state.wait)await state.wait;if(state.throwApproval)throw new Error('network uncertain');return state.approval;};export const requestStdPayNetCancel=async()=>{calls.push({method:'netCancel'});return {ok:state.cancelOk,data:{resultCode:state.cancelOk?'0000':'9999'}};};`,
      "@/lib/inicis/config": `export const getStdPayConfig=()=>({mid:'fixture-mid',signKey:'fixture-sign-key',env:'stg',stdJsUrl:'https://fixture.invalid/sdk.js'});`,
      "@/lib/inicis/crypto": `export const getInicisTimestamp=()=> 'fixture-time';export const makeAuthSecureSignature=()=> 'valid-signature';export const sha256=()=> 'fixture-hash';`,
      "@/lib/payments/submission": `import {state,calls} from 'approval-fixture';export const getPaymentByOrderId=async()=>({payment:structuredClone(state.payment),error:null});export const markPaymentFailure=async(...args)=>{calls.push({method:'preApprovalFailure',args});return {ok:true};};export const markPaymentSuccess=async(...args)=>{calls.push({method:'paid',args});return {ok:state.persistOk,error:state.persistOk?null:'database response lost',submissionId:'${ID}'};};`,
      "@/lib/payments/karaoke": `export const getKaraokePaymentByOrderId=async()=>({payment:null});export const markKaraokePaymentFailure=async()=>({ok:true});export const markKaraokePaymentSuccess=async()=>({ok:true});`,
      "@/lib/supabase/admin": `import {state,calls} from 'approval-fixture';export const createAdminClient=()=>({rpc:async(method,args)=>{calls.push({method,args});if(method==='claim_inicis_submission_approval'){if(state.claim==='invalid')return {data:null,error:{code:'42501'}};const previous=state.claim;state.claim='processing';return {data:[{already_approved:previous==='approved',already_processing:previous==='processing'}],error:null};}return {data:[{final_status:args.p_outcome==='FAILED'?'FAILED':'REVIEW_REQUIRED'}],error:null};}});`,
      "@/lib/payment-result-grant": `export const createPaymentResultGrant=()=>null;export const setPaymentResultGrantCookie=()=>{};`,
      "@/lib/url": `export const getBaseUrl=()=> 'https://onside.test';`,
    };
    plugin.onResolve({ filter: /^(approval-fixture|@\/lib\/)/ }, args => files[args.path] ? ({ path: args.path, namespace: "approval-fixture" }) : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "approval-fixture" }, ({ path }) => ({ loader: "js", contents: files[path] }));
  } }],
});

type Harness = {
  handleInicisReturn: typeof import("../src/app/api/inicis/return/handler").handleInicisReturn;
  state: { payment: { status: string }; claim: string; approval: { ok: boolean; data: Record<string, unknown> | null; confirmedFailure?: boolean }; cancelOk: boolean; persistOk: boolean; throwApproval: boolean; wait: Promise<void> | null; release: (() => void) | null };
  calls: Array<{ method: string; args?: Record<string, unknown> }>;
};
const harness = async () => {
  const result = await handlerBundle;
  const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
};
const callback = (state = STATE) => new NextRequest("https://onside.test/api/inicis/return", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ orderNumber: ORDER, mid: "fixture-mid", merchantData: state, resultCode: "0000", authToken: "fixture-auth-token", authUrl: "https://stdpay.inicis.com/api/approval", netCancelUrl: "https://stdpay.inicis.com/api/netcancel", price: "49000" }),
});
const silence = (t: TestContext) => {
  t.mock.method(console, "info", () => undefined);
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);
};

test("Inicis approval claims before the gateway and rejects invalid, terminal, or concurrent callbacks", async (t) => {
  silence(t);
  for (const scenario of ["invalid-state", "invalid-claim", "processing", "approved", "terminal"] as const) {
    const h = await harness();
    if (scenario === "invalid-claim") h.state.claim = "invalid";
    if (scenario === "processing" || scenario === "approved") h.state.claim = scenario;
    if (scenario === "terminal") h.state.payment.status = "CANCELED";
    const response = await h.handleInicisReturn(callback(scenario === "invalid-state" ? "invalid-state" : STATE));
    assert.equal(response.status, 303);
    assert.equal(h.calls.filter(call => call.method === "gateway").length, 0, scenario);
    assert.equal(h.calls.filter(call => call.method === "paid").length, 0, scenario);
  }
  const h = await harness();
  h.state.wait = new Promise(resolve => { h.state.release = resolve; });
  const first = h.handleInicisReturn(callback());
  for (let i = 0; i < 30 && !h.calls.some(call => call.method === "gateway"); i++) await new Promise(resolve => setImmediate(resolve));
  const duplicate = await h.handleInicisReturn(callback());
  assert.match(duplicate.headers.get("location") ?? "", /status=ERROR/);
  assert.equal(h.calls.filter(call => call.method === "gateway").length, 1);
  h.state.release?.();
  const success = await first;
  assert.match(success.headers.get("location") ?? "", /status=SUCCESS/);
  assert.deepEqual(h.calls.map(call => call.method), ["claim_inicis_submission_approval", "gateway", "claim_inicis_submission_approval", "paid"]);
});

test("unknown gateway outcomes stay locked while confirmed rejection is safely closed", async (t) => {
  silence(t);
  for (const scenario of ["unknown", "confirmed-rejection", "exception", "wrong-order-canceled", "wrong-order-uncertain", "persistence-uncertain"] as const) {
    const h = await harness();
    if (scenario === "unknown") h.state.approval = { ok: false, data: null };
    if (scenario === "confirmed-rejection") h.state.approval = { ok: false, data: { resultCode: "9999", resultMsg: "Declined" }, confirmedFailure: true };
    if (scenario === "exception") h.state.throwApproval = true;
    if (scenario.startsWith("wrong-order")) {
      h.state.approval.data!.MOID = "different-order";
      h.state.cancelOk = scenario === "wrong-order-canceled";
    }
    if (scenario === "persistence-uncertain") h.state.persistOk = false;
    const response = await h.handleInicisReturn(callback());
    assert.equal(response.status, 303, scenario);
    assert.match(response.headers.get("location") ?? "", new RegExp(`submissionId=${ID}`));
    const settled = h.calls.find(call => call.method === "settle_inicis_submission_approval");
    assert.equal(settled?.args?.p_outcome, ["confirmed-rejection", "wrong-order-canceled"].includes(scenario) ? "FAILED" : "UNCERTAIN", scenario);
    assert.equal(h.calls.filter(call => call.method === "preApprovalFailure").length, 0, scenario);
    if (scenario === "persistence-uncertain") assert.equal(h.calls.filter(call => call.method === "netCancel").length, 0, "an unknown database commit must not cancel a possibly-paid charge");
  }
});

const apiBundle = build({
  stdin: { contents: `export {requestStdPayApproval,requestStdPayNetCancel} from './src/lib/inicis/api';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  plugins: [{ name: "api-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/config$/ }, args => args.importer.endsWith("/inicis/api.ts") ? ({ path: "config", namespace: "api-fixture" }) : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "api-fixture" }, () => ({ loader: "js", contents: `export const getStdPayConfig=()=>({mid:'fixture-mid',signKey:'fixture-key'});export const getBillingConfig=()=>({});` }));
  } }],
});

test("gateway transport only reports cancellation or rejection after explicit provider confirmation", async (t) => {
  const result = await apiBundle;
  const loaded = { exports: {} as typeof import("../src/lib/inicis/api") };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  for (const scenario of ["empty", "malformed", "declined", "timeout-cancelled", "timeout-uncertain"] as const) {
    t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/cancel")) return scenario === "timeout-cancelled" ? Response.json({ resultCode: "0000" }) : new Response("");
      if (scenario.startsWith("timeout")) throw new Error("timeout");
      if (scenario === "empty") return new Response("");
      if (scenario === "malformed") return Response.json({ unexpected: "body" });
      return Response.json({ resultCode: "9999", resultMsg: "Declined" });
    });
    const response = await loaded.exports.requestStdPayApproval({ authUrl: "https://stdpay.inicis.com/approve", netCancelUrl: "https://stdpay.inicis.com/cancel", authToken: "fixture-token", timestamp: "fixture-time" });
    assert.equal(response.ok, false);
    assert.equal(response.confirmedFailure, scenario === "declined" || scenario === "timeout-cancelled", scenario);
    t.mock.restoreAll();
  }
});
