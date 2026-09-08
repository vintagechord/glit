import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { confirmLinkedOrderPayment } from "../src/lib/admin/order-payment";

const ID = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const STATE = "30000000-0000-4000-8000-000000000001";
const ORDER = "fixture-order";
const CLOSE = `https://onside.test/api/inicis/close?oid=${ORDER}&state=${STATE}`;

const browserBundle = build({
  stdin: { contents: `export * from './src/lib/inicis/popup'; export * from './src/lib/inicis/popup-recovery'; export * from './src/lib/guest-submission-cart';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
});

test("SDK load and pay failures close the initialized order and preserve guest order access", async (t) => {
  const result = await browserBundle;
  const loaded = { exports: {} as typeof import("../src/lib/inicis/popup") & typeof import("../src/lib/inicis/popup-recovery") & typeof import("../src/lib/guest-submission-cart") };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const saved = Object.fromEntries(["window", "document", "fetch"].map(key => [key, Reflect.get(globalThis, key)]));
  t.mock.method(console, "error", () => undefined);
  try {
    for (const scenario of ["load-error", "pay-error", "success"] as const) {
      const calls: { url: string; method: string }[] = [];
      const storage = new Map<string, string>();
      const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
      const elements = new Map<string, unknown>();
      const element = (tagName: string) => ({ tagName, id: "", style: { removeProperty() {} }, listeners: {} as Record<string, () => void>, addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; }, removeEventListener(name: string) { delete this.listeners[name]; }, appendChild() {}, remove() {}, getAttribute() { return null; } });
      const body = element("body");
      Reflect.set(globalThis, "document", { documentElement: element("html"), body, querySelectorAll: () => [], querySelector: () => null, getElementById: (id: string) => elements.get(id) ?? null, createElement: element });
      Object.assign(body, { appendChild(el: ReturnType<typeof element>) { if (el.id) elements.set(el.id, el); if (el.tagName === "script") queueMicrotask(() => el.listeners.error?.()); } });
      Reflect.set(globalThis, "window", { navigator: { userAgent: "Desktop fixture" }, location: { pathname: "/en/mypage/cart", origin: "https://onside.test" }, localStorage: store, sessionStorage: store, dispatchEvent() {}, setTimeout, clearTimeout, INIStdPay: scenario === "load-error" ? undefined : { pay() { if (scenario === "pay-error") throw new Error("SDK failed"); } } });
      Reflect.set(globalThis, "fetch", async (url: string, options: RequestInit = {}) => {
        calls.push({ url: String(url), method: options.method ?? "GET" });
        if (String(url).includes("/close?")) return new Response("fixture close bridge");
        return Response.json({ orderId: ORDER, stdJsUrl: "https://fixture.invalid/sdk.js", stdParams: { oid: ORDER, closeUrl: CLOSE }, closeUrl: CLOSE });
      });
      const opened = await loaded.exports.openInicisCardPopup({ context: "music", submissionId: ID, guestToken: "guest-private-token" });
      assert.equal(opened.orderId, ORDER, "even a failed SDK start retains its order identifier");
      assert.equal(opened.ok, scenario === "success");
      assert.deepEqual(calls, scenario === "success" ? [{ url: "/api/inicis/submission/order", method: "POST" }] : [{ url: "/api/inicis/submission/order", method: "POST" }, { url: CLOSE, method: "POST" }]);
      assert.deepEqual(loaded.exports.readGuestSubmissionOrderEntries(), [{ submissionId: ID, guestToken: "guest-private-token" }]);
      assert.equal(loaded.exports.submissionOrderReturnHref(ID), `/en/mypage/orders?focus=${ID}`);
      assert.ok(calls.every(call => !call.url.includes("guest-private-token")));

      calls.length = 0;
      for (const closeUrl of [CLOSE.replace("onside.test", "foreign.invalid"), CLOSE.replace(ORDER, "wrong-order"), CLOSE.replace(STATE, "invalid"), CLOSE.replace("/close?", "/unexpected?")]) {
        assert.equal(await loaded.exports.cancelUnopenedInicisOrder({ orderId: ORDER, closeUrl }), false);
      }
      assert.equal(calls.length, 0, "untrusted close URLs never send a request");
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key);
      else Reflect.set(globalThis, key, value);
    }
  }
});

test("linked admin payments confirm the entire bank order and never reset or manually approve gateway orders", async () => {
  const calls: { method: string; args: unknown }[] = [];
  let order = { id: ORDER, status: "BANK_PENDING", payment_method: "BANK" };
  const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: order, error: null }; } };
  const db = {
    from() { return query; },
    async rpc(method: string, args: unknown) { calls.push({ method, args }); return { data: [{ submission_id: ID }, { submission_id: OTHER }], error: null }; },
  } as unknown as Parameters<typeof confirmLinkedOrderPayment>[0];
  const input = { orderId: ORDER, currentPaymentStatus: "PAYMENT_PENDING", nextPaymentStatus: "PAID", actorUserId: "admin-fixture", adminMemo: "Deposit checked" };
  assert.deepEqual(await confirmLinkedOrderPayment(db, input), { confirmedIds: [ID, OTHER] });
  assert.deepEqual(calls, [{ method: "confirm_submission_order_bank_payment", args: { p_order_id: ORDER, p_actor_user_id: "admin-fixture", p_admin_memo: "Deposit checked" } }]);
  calls.length = 0;
  for (const nextPaymentStatus of ["UNPAID", "REFUNDED"]) {
    assert.ok((await confirmLinkedOrderPayment(db, { ...input, nextPaymentStatus })).error);
  }
  for (const status of ["CARD_PENDING", "PAYPAL_PENDING", "FAILED", "CANCELED", "REVIEW_REQUIRED"]) {
    order = { id: ORDER, status, payment_method: "CARD" };
    assert.ok((await confirmLinkedOrderPayment(db, input)).error);
  }
  assert.equal(calls.length, 0);
  order = { id: ORDER, status: "PAID", payment_method: "CARD" };
  assert.deepEqual(await confirmLinkedOrderPayment(db, { ...input, currentPaymentStatus: "PAID" }), {});
  assert.ok((await confirmLinkedOrderPayment(db, { ...input, currentPaymentStatus: "PAID", nextPaymentStatus: "PAYMENT_PENDING" })).error);
  assert.equal(calls.length, 0, "review stage edits of an already-paid order do not issue another confirmation");
});

const serverBundle = build({
  stdin: { contents: `export { PATCH, POST } from './src/app/api/submissions/[id]/payment-method/route'; export { redirectLegacyPaymentPage } from './src/lib/legacy-payment-redirect'; export { state, calls } from 'navigation-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  plugins: [{ name: "navigation-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(navigation-fixture|@\/lib\/supabase\/(?:server|server-user)|next\/navigation)$/ }, args => ({ path: args.path, namespace: "navigation-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "navigation-fixture" }, ({ path }) => {
      const files: Record<string, string> = {
        "navigation-fixture": `export const state={user:{id:'owner'},row:{id:'${ID}',user_id:'owner',current_order_id:null}};export const calls=[];`,
        "@/lib/supabase/server-user": `import {state,calls} from 'navigation-fixture';export const getServerSessionUser=async()=>{calls.push({method:'auth'});return state.user;};`,
        "@/lib/supabase/server": `import {state,calls} from 'navigation-fixture';export const createServerSupabase=async()=>({from(table){const filters=[];const q={select(){return q;},eq(...args){filters.push(args);return q;},async maybeSingle(){calls.push({method:'query',table,filters});return {data:state.row&&filters.every(([key,value])=>state.row[key]===value)?state.row:null,error:null};}};return q;}});`,
        "next/navigation": `export const redirect=location=>{throw Object.assign(new Error('redirect'),{location});};export const notFound=()=>{throw Object.assign(new Error('not found'),{notFound:true});};`,
      };
      return { loader: "js", contents: files[path] };
    });
  } }],
});

test("legacy payment mutation is gone and old pay URLs only redirect after owner verification", async () => {
  const result = await serverBundle;
  type Harness = {
    PATCH: () => Promise<Response>; POST: () => Promise<Response>;
    redirectLegacyPaymentPage: typeof import("../src/lib/legacy-payment-redirect").redirectLegacyPaymentPage;
    state: { user: { id: string } | null; row: { id: string; user_id: string; current_order_id: string | null } };
    calls: { method: string; table?: string; filters?: unknown[] }[];
  };
  const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const h = loaded.exports;
  for (const handler of [h.PATCH, h.POST]) {
    const response = await handler();
    assert.equal(response.status, 410);
    assert.equal(h.calls.length, 0, "retired API performs no authentication, read or write");
  }
  for (const locale of ["ko", "en"] as const) {
    for (const orderId of [null, ORDER]) {
      h.state.row.current_order_id = orderId;
      const expected = `${locale === "en" ? "/en" : ""}/mypage/${orderId ? "orders" : "cart"}?focus=${ID}`;
      await assert.rejects(h.redirectLegacyPaymentPage({ params: Promise.resolve({ id: ID }) }, locale), (error: unknown) => (error as { location?: string }).location === expected);
    }
  }
  h.state.row.user_id = "other-owner";
  await assert.rejects(h.redirectLegacyPaymentPage({ params: Promise.resolve({ id: ID }) }), (error: unknown) => (error as { notFound?: boolean }).notFound === true);
  h.state.user = null;
  await assert.rejects(h.redirectLegacyPaymentPage({ params: Promise.resolve({ id: ID }) }, "en"), (error: unknown) => (error as { location?: string }).location?.startsWith("/en/login?next=") === true);
});
