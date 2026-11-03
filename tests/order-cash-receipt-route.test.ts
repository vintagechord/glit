import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const OWNER = "10000000-0000-4000-8000-000000000001";
const ORDER = "20000000-0000-4000-8000-000000000001";
const ITEM = "30000000-0000-4000-8000-000000000001";
type Harness = {
  GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  state: { user: { id: string } | null; orderStatus: string; receiptStatus: string };
  calls: Array<{ method: string; args: unknown[] }>;
};

// The real route and validation; sessions, ownership and storage are fixtures.
const bundle = build({
  stdin: { contents: `export {GET,POST} from './src/app/api/orders/[id]/cash-receipt/route'; export {state,calls} from 'receipt-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "receipt-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(receipt-fixture|@\/lib\/supabase\/(?:admin|server|server-user)|@\/lib\/(?:submission-orders|cash-receipts-server|request-rate-limit|url))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
      const shared = `import {state,calls} from 'receipt-fixture';`;
      const modules: Record<string, string> = {
        "receipt-fixture": `export const state={user:{id:'${OWNER}'},orderStatus:'PAID',receiptStatus:'ISSUED'}; export const calls=[];`,
        "@/lib/supabase/admin": `export const createAdminClient=()=>({});`,
        "@/lib/supabase/server": `export const createServerSupabase=async()=>({});`,
        "@/lib/supabase/server-user": `${shared} export const getServerSessionUser=async()=>state.user;`,
        "@/lib/submission-orders": `${shared} export const loadOwnedSubmissionOrder=async(_db,...args)=>{calls.push({method:'owned',args});return {ok:true,order:{id:'${ORDER}',payment_method:'BANK',status:state.orderStatus}};};`,
        "@/lib/cash-receipts-server": `${shared} export const loadCashReceiptOrder=async()=>({id:'${ORDER}',status:state.orderStatus,items:[]}); export const loadCashReceiptRows=async()=>new Map([['${ORDER}',{order_id:'${ORDER}',status:state.receiptStatus,approval_number:'269620648'}]]); export const renderCashReceiptPdf=async()=>{calls.push({method:'pdf',args:[]});return new Uint8Array([37,80,68,70]);}; export const cashReceiptPdfFilename=()=> 'receipt.pdf'; export const saveCashReceiptRequest=async(_db,...args)=>{calls.push({method:'save',args});return {ok:true,value:null};};`,
        "@/lib/request-rate-limit": `export const getRequestIdentifier=()=> 'test-ip'; export const consumeRateLimit=()=>({allowed:true,retryAfterSeconds:0});`,
        "@/lib/url": `export const getBaseUrl=()=> 'https://onside.test';`,
      };
      return { loader: "js", contents: modules[path] };
    });
  } }],
});
async function harness() {
  const result = await bundle; const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  loaded.exports.calls.length = 0;
  return loaded.exports;
}
const params = { params: Promise.resolve({ id: ORDER }) };
const tokens = { [ITEM]: "guest-private-token" };

test("a signed-in customer keeps using this browser's guest proofs for orders placed before signing in", async () => {
  const h = await harness();
  const download = await h.GET(new Request(`https://onside.test/api/orders/${ORDER}/cash-receipt`, {
    headers: { "x-order-guest-tokens": encodeURIComponent(JSON.stringify(tokens)) },
  }), params);
  assert.equal(download.status, 200);
  assert.deepEqual(h.calls.find(call => call.method === "owned")?.args, [ORDER, { userId: OWNER, guestTokensBySubmissionId: tokens }]);
  h.calls.length = 0;
  const saved = await h.POST(new Request(`https://onside.test/api/orders/${ORDER}/cash-receipt`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://onside.test" },
    body: JSON.stringify({ guestTokensBySubmissionId: tokens, cashReceipt: null }),
  }), params);
  assert.equal(saved.status, 200);
  assert.deepEqual(h.calls.find(call => call.method === "owned")?.args, [ORDER, { userId: OWNER, guestTokensBySubmissionId: tokens }]);
});

test("the receipt PDF of a refunded or cancelled order is withheld until its cancellation is recorded", async () => {
  for (const [orderStatus, receiptStatus, expected] of [["REFUNDED", "ISSUED", 409], ["CANCELED", "ISSUED", 409], ["REFUNDED", "CANCELED", 200], ["PAID", "ISSUED", 200]] as const) {
    const h = await harness();
    h.state.orderStatus = orderStatus; h.state.receiptStatus = receiptStatus;
    const response = await h.GET(new Request(`https://onside.test/api/orders/${ORDER}/cash-receipt`), params);
    assert.equal(response.status, expected, `${orderStatus}/${receiptStatus}`);
    assert.equal(h.calls.some(call => call.method === "pdf"), expected === 200, `${orderStatus}/${receiptStatus}`);
  }
});
