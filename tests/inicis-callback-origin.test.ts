import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { build } from "esbuild";
import { NextRequest } from "next/server";

import { getInicisCallbackBaseUrl } from "../src/lib/inicis/callback-origin";

const canonical = "https://iamonside.com";
const legacy = "https://glit-b1yn.onrender.com";
const legacyHost = new URL(legacy).host;

function configure(t: TestContext) {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = canonical;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
}

test("only the exact legacy Host keeps an existing payment callback on its original HTTPS origin", t => {
  configure(t);
  for (const internal of ["http://localhost:10000", `http://${legacyHost}`, legacy]) {
    assert.equal(getInicisCallbackBaseUrl(new Request(`${internal}/api/inicis/return`, {
      headers: { host: legacyHost, "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" },
    })), legacy);
  }
  assert.equal(getInicisCallbackBaseUrl(new Request(`${legacy}/api/inicis/return`, { headers: { host: legacyHost.toUpperCase() } })), legacy);
  for (const host of ["iamonside.com", "attacker.invalid", `${legacyHost}.attacker.invalid`, `${legacyHost}:443`, `${legacyHost}@attacker.invalid`, `${legacyHost},attacker.invalid`]) {
    assert.equal(getInicisCallbackBaseUrl(new Request("http://localhost:10000/api/inicis/return", {
      headers: { host, "x-forwarded-host": legacyHost, "x-forwarded-proto": "https" },
    })), canonical, host);
  }
  assert.equal(getInicisCallbackBaseUrl(new Request(`${legacy}/api/inicis/return`, { headers: { "x-forwarded-host": legacyHost } })), canonical);
});

type Callback = (request: NextRequest) => Promise<Response>;
async function callbacks() {
  const compiled = await build({
    stdin: { contents: `export {handleInicisReturn as standard} from './src/app/api/inicis/return/handler';export {POST as subscriptionPc} from './src/app/api/inicis/key-return/route';export {POST as subscriptionMobile} from './src/app/api/inicis/mobile-return/route';export {POST as submissionOrder} from './src/app/api/inicis/submission/order/route';export {POST as karaokeOrder} from './src/app/api/inicis/karaoke/order/route';`, loader: "ts", resolveDir: process.cwd() },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false, drop: ["console"],
    plugins: [{ name: "no-payment-side-effects", setup(plugin) {
      plugin.onResolve({ filter: /(?:inicis\/config|payments\/(?:submission|karaoke)|subscriptions\/service)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        if (path.endsWith("/config")) return { loader: "js", contents: `export const getStdPayConfig=()=>({env:'prod',mid:'fixture-mid',signKey:'fixture-only',stdJsUrl:'https://stdpay.inicis.com/stdjs/INIStdPay.js'});export const getBillingConfig=()=>({mid:'fixture-mid'});export const getInicisMode=()=> 'prod';export const getInicisMobileHashKey=()=>null;export const isInicisMobileCardConfigured=()=>false;export const getInicisMobileRequestUrl=()=> 'https://mobile.inicis.com/smart/payment/';` };
        const exports = path.endsWith("/submission") ? ["getPaymentByOrderId", "markPaymentFailure", "markPaymentSuccess"]
          : path.endsWith("/karaoke") ? ["getKaraokePaymentByOrderId", "markKaraokePaymentFailure", "markKaraokePaymentSuccess"]
            : ["claimSubscriptionBillingCallback", "failSubscriptionBillingCallback", "finalizeSubscriptionBillingCallback", "recordSubscriptionBillingUncertain", "recordSubscriptionBillKeyForCallback"];
        const init = path.endsWith("/submission") ? ["ensureSubmissionOwner", "createSubmissionPaymentOrder"]
          : path.endsWith("/karaoke") ? ["ensureKaraokeRequestOwner", "createKaraokePaymentOrder"] : null;
        const initFixture = init ? `export async function ${init[0]}(){return {error:null};} export async function ${init[1]}(id,baseUrl){return {error:null,result:{orderId:'fixture-order',returnUrl:new URL('/api/inicis/return',baseUrl).toString(),closeUrl:new URL('/api/inicis/close',baseUrl).toString()}};}` : "";
        return { loader: "js", contents: exports.map(name => `export function ${name}(){throw new Error('Payment side effect must not run in origin tests');}`).join("\n") + initFixture };
      });
    } }],
  });
  const result = { exports: {} as { standard: Callback; subscriptionPc: Callback; subscriptionMobile: Callback; submissionOrder: Callback; karaokeOrder: Callback } };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), result, result.exports);
  return result.exports;
}

test("STDPay bridge and both subscription result routes retain old cookies and opener origin after canonical switch", async t => {
  configure(t);
  const handlers = await callbacks();
  for (const [host, expected] of [[legacyHost, legacy], ["iamonside.com", canonical], ["attacker.invalid", canonical]]) {
    for (const [handler, path, body, resultPath] of [
      [handlers.standard, "/api/inicis/return", new URLSearchParams({ resultCode: "9999" }), "/pay/inicis/return"],
      [handlers.subscriptionPc, "/api/inicis/key-return", new URLSearchParams({ oid: "fixture-order", merchantData: "s".repeat(32), mid: "mismatched-fixture-mid" }), "/subscription/result"],
      [handlers.subscriptionMobile, "/api/inicis/mobile-return", new URLSearchParams({ orderid: "fixture-order", merchantreserved: "s".repeat(32), mid: "mismatched-fixture-mid" }), "/subscription/result"],
    ] as const) {
      const response = await handler(new NextRequest(`http://localhost:10000${path}`, { method: "POST", headers: {
        host, "content-type": "application/x-www-form-urlencoded", "x-forwarded-host": legacyHost,
      }, body }));
      assert.equal(response.status, 303);
      const target = new URL(response.headers.get("location")!);
      assert.equal(target.origin, expected, `${host} ${path}`);
      assert.equal(target.pathname, resultPath);
      assert.equal(response.headers.get("set-cookie"), null, "unverified result callbacks must not create a guest result grant");
    }
  }
});

test("checkout from cached legacy pages builds matching return and close origins while new pages use the final domain", async t => {
  configure(t);
  const handlers = await callbacks();
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [host, expected] of [[legacyHost, legacy], ["iamonside.com", canonical], ["attacker.invalid", canonical]]) {
    for (const [handler, path, payload] of [
      [handlers.submissionOrder, "/api/inicis/submission/order", { submissionId: id, context: "music" }],
      [handlers.karaokeOrder, "/api/inicis/karaoke/order", { requestId: id, context: "karaoke" }],
    ] as const) {
      const response = await handler(new NextRequest(`http://localhost:10000${path}`, { method: "POST", headers: {
        host, "content-type": "application/json", "x-forwarded-host": legacyHost,
      }, body: JSON.stringify(payload) }));
      assert.equal(response.status, 200);
      const body = await response.json() as { returnUrl: string; closeUrl: string };
      assert.equal(new URL(body.returnUrl).origin, expected, `${host} ${path} return`);
      assert.equal(new URL(body.closeUrl).origin, expected, `${host} ${path} close`);
    }
  }
});
