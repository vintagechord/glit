import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { confirmLinkedOrderPayment, resolveUncertainCardPayment, statusAfterPaymentConfirmation } from "../src/lib/admin/order-payment";
import type { InicisInquiryResult, InicisTransaction } from "../src/lib/inicis/transaction-inquiry";

const ID = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const STATE = "30000000-0000-4000-8000-000000000001";
const ORDER = "fixture-order";
const CLOSE = `https://onside.test/api/inicis/close?oid=${ORDER}&state=${STATE}`;

test("deposit confirmation queues material review and never regresses review or result stages", () => {
  for (const status of ["DRAFT", "SUBMITTED", "WAITING_PAYMENT"] as const) {
    assert.equal(statusAfterPaymentConfirmation(status), "PRE_REVIEW");
  }
  for (const status of ["PRE_REVIEW", "IN_PROGRESS", "RESULT_READY", "COMPLETED"] as const) {
    assert.equal(statusAfterPaymentConfirmation(status), status);
  }
});

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

test("a karaoke card window that never opens closes its attempt, so the same request can be paid again", async (t) => {
  // Only submission checkouts closed an unopened order. A karaoke attempt left
  // REQUESTED refused every retry of the request (KARAOKE_PAYMENT_ALREADY_IN_PROGRESS).
  const result = await browserBundle;
  const loaded = { exports: {} as typeof import("../src/lib/inicis/popup") };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const saved = Object.fromEntries(["window", "document", "fetch"].map(key => [key, Reflect.get(globalThis, key)]));
  t.mock.method(console, "error", () => undefined);
  try {
    const calls: { url: string; method: string }[] = [];
    const store = { getItem: () => null, setItem() {}, removeItem() {} };
    const element = (tagName: string) => ({ tagName, id: "", style: { removeProperty() {} }, listeners: {} as Record<string, () => void>, addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; }, removeEventListener(name: string) { delete this.listeners[name]; }, appendChild() {}, remove() {}, getAttribute() { return null; } });
    const body = element("body");
    Reflect.set(globalThis, "document", { documentElement: element("html"), body, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, createElement: element });
    Object.assign(body, { appendChild(el: ReturnType<typeof element>) { if (el.tagName === "script") queueMicrotask(() => el.listeners.error?.()); } });
    Reflect.set(globalThis, "window", { navigator: { userAgent: "Desktop fixture" }, location: { pathname: "/karaoke-request", origin: "https://onside.test" }, localStorage: store, sessionStorage: store, dispatchEvent() {}, setTimeout, clearTimeout });
    Reflect.set(globalThis, "fetch", async (url: string, options: RequestInit = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      if (String(url).includes("/close?")) return new Response("fixture close bridge");
      return Response.json({ orderId: ORDER, stdJsUrl: "https://fixture.invalid/sdk.js", stdParams: { oid: ORDER, closeUrl: CLOSE } });
    });
    const opened = await loaded.exports.openInicisCardPopup({ context: "karaoke", requestId: ID });
    assert.equal(opened.ok, false);
    assert.deepEqual(calls.map(call => [call.url.replace(/\?.*$/, ""), call.method]), [["/api/inicis/karaoke/order", "POST"], [CLOSE.replace(/\?.*$/, ""), "POST"]]);
    assert.equal(calls[1].url, CLOSE);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key);
      else Reflect.set(globalThis, key, value);
    }
  }
});

test("linked admin payments confirm the entire order (bank deposit or an unfinished card order) and never reset it", async () => {
  const calls: { method: string; args: unknown }[] = [];
  let order = { id: ORDER, status: "BANK_PENDING", payment_method: "BANK" };
  let rpcFailure: { code?: string; message?: string } | null = null;
  const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: order, error: null }; } };
  const db = {
    from() { return query; },
    async rpc(method: string, args: unknown) { calls.push({ method, args }); return rpcFailure ? { data: null, error: rpcFailure } : { data: [{ submission_id: ID }, { submission_id: OTHER }], error: null }; },
  } as unknown as Parameters<typeof confirmLinkedOrderPayment>[0];
  const input = { orderId: ORDER, currentPaymentStatus: "PAYMENT_PENDING", nextPaymentStatus: "PAID", actorUserId: "admin-fixture", adminMemo: "Deposit checked" };
  assert.deepEqual(await confirmLinkedOrderPayment(db, input), { confirmedIds: [ID, OTHER], confirmedMethod: "BANK" });
  assert.deepEqual(calls, [{ method: "confirm_submission_order_bank_payment", args: { p_order_id: ORDER, p_actor_user_id: "admin-fixture", p_admin_memo: "Deposit checked" } }]);
  calls.length = 0;
  for (const nextPaymentStatus of ["UNPAID", "REFUNDED"]) {
    assert.ok((await confirmLinkedOrderPayment(db, { ...input, nextPaymentStatus })).error);
  }
  // An administrator may settle a card or PayPal order whose payment never
  // finished (window abandoned, failed or canceled) without a gateway approval.
  for (const [status, method] of [["CARD_PENDING", "CARD"], ["FAILED", "CARD"], ["CANCELED", "CARD"], ["PAYPAL_PENDING", "PAYPAL"]] as const) {
    order = { id: ORDER, status, payment_method: method };
    assert.deepEqual(await confirmLinkedOrderPayment(db, input), { confirmedIds: [ID, OTHER], confirmedMethod: method });
    assert.deepEqual(calls, [{ method: "admin_confirm_unpaid_order_payment", args: { p_order_id: ORDER, p_actor_user_id: "admin-fixture", p_admin_memo: "Deposit checked" } }]);
    calls.length = 0;
  }
  // An approval the gateway is still confirming is settled under 결제 내역.
  order = { id: ORDER, status: "REVIEW_REQUIRED", payment_method: "CARD" };
  assert.match((await confirmLinkedOrderPayment(db, input)).error ?? "", /결제 내역/);
  assert.equal(calls.length, 0);
  order = { id: ORDER, status: "CARD_PENDING", payment_method: "CARD" };
  for (const [message, expected] of [["PAYMENT_APPROVAL_IN_PROGRESS", /결제 내역/], ["ORDER_NOT_CONFIRMABLE", /새로고침/], ["PAYMENT_ALREADY_APPROVED", /새로고침/], ["boom", /저장하지 못했습니다/]] as const) {
    rpcFailure = { message };
    assert.match((await confirmLinkedOrderPayment(db, input)).error ?? "", expected);
  }
  rpcFailure = null;
  calls.length = 0;
  for (const status of ["REFUNDED", "CANCELED"]) {
    order = { id: ORDER, status, payment_method: "BANK" };
    assert.ok((await confirmLinkedOrderPayment(db, input)).error);
  }
  assert.equal(calls.length, 0);
  order = { id: ORDER, status: "PAID", payment_method: "CARD" };
  assert.deepEqual(await confirmLinkedOrderPayment(db, { ...input, currentPaymentStatus: "PAID" }), {});
  assert.ok((await confirmLinkedOrderPayment(db, { ...input, currentPaymentStatus: "PAID", nextPaymentStatus: "PAYMENT_PENDING" })).error);
  assert.equal(calls.length, 0, "review stage edits of an already-paid order do not issue another confirmation");

  // A refund is recorded for the whole order through its own RPC, only from PAID.
  assert.deepEqual(await confirmLinkedOrderPayment(db, { ...input, currentPaymentStatus: "PAID", nextPaymentStatus: "REFUNDED", adminMemo: "PG cancelled" }), { refundedIds: [ID, OTHER] });
  assert.deepEqual(calls, [{ method: "refund_submission_order", args: { p_order_id: ORDER, p_actor_user_id: "admin-fixture", p_admin_memo: "PG cancelled" } }]);
  calls.length = 0;
  assert.ok((await confirmLinkedOrderPayment(db, { ...input, currentPaymentStatus: "PAYMENT_PENDING", nextPaymentStatus: "REFUNDED" })).error);
  assert.equal(calls.length, 0);
});

test("uncertain card approvals are resolved through the reconciliation RPC with readable failures", async () => {
  const calls: { method: string; args: unknown }[] = [];
  let failure: { code?: string; message?: string } | null = null;
  let payment: Record<string, unknown> | null = { order_id: ORDER, amount_krw: 50000, status: "REQUESTED", result_code: "APPROVAL_UNCERTAIN" };
  const db = {
    async rpc(method: string, args: unknown) { calls.push({ method, args }); return failure ? { data: null, error: failure } : { data: [{ submission_id: ID }], error: null }; },
    from(table: string) {
      assert.equal(table, "submission_payments");
      return { select: () => ({ eq: (column: string, value: string) => {
        assert.deepEqual([column, value], ["order_id", ORDER]);
        return { maybeSingle: async () => ({ data: payment, error: null }) };
      } }) };
    },
  } as unknown as Parameters<typeof resolveUncertainCardPayment>[0];
  const inquiries: string[] = [];
  const tx: InicisTransaction = { tid: "tid-123", oid: ORDER, mid: "MID", priceKrw: 50000, status: "APPROVED", rawStatus: "APPROVAL", payMethod: "Card", approvedNumber: "30012345", approvedAt: "2026-11-26T01:10:10.000Z" };
  let gateway: InicisInquiryResult = { ok: true, transaction: tx };
  const deps = { inquire: async (tid: string) => { inquiries.push(tid); return gateway; }, now: () => new Date("2026-11-26T01:20:00Z") };
  const approve = () => resolveUncertainCardPayment(db, { orderId: ORDER, actorUserId: "admin-fixture", outcome: "APPROVED", pgTid: " tid-123 ", adminMemo: "" }, deps);

  // The entered TID is looked up at Inicis; the RPC receives what Inicis answered.
  assert.deepEqual(await approve(), { submissionIds: [ID] });
  assert.deepEqual(inquiries, ["tid-123"]);
  assert.deepEqual(calls, [{ method: "resolve_uncertain_submission_payment", args: {
    p_order_id: ORDER, p_actor_user_id: "admin-fixture", p_outcome: "APPROVED", p_pg_tid: "tid-123", p_admin_memo: null,
    p_gateway_evidence: {
      source: "INIAPI_V2_INQUIRY", tid: "tid-123", oid: ORDER, mid: "MID", priceKrw: 50000, status: "APPROVED", transactionStatus: "APPROVAL",
      payMethod: "Card", approvedNumber: "30012345", approvedAt: "2026-11-26T01:10:10.000Z", checkedAt: "2026-11-26T01:20:00.000Z",
    },
  } }]);

  // Nothing is recorded when Inicis does not confirm this order's approval.
  const refused: [InicisInquiryResult, RegExp][] = [
    [{ ok: false, code: "NOT_FOUND", message: "이니시스에 이 TID의 거래가 없습니다." }, /거래가 없습니다/],
    [{ ok: false, code: "NETWORK_ERROR", message: "이니시스 거래 조회에 응답이 없습니다." }, /응답이 없습니다/],
    [{ ok: true, transaction: { ...tx, oid: "other-order" } }, /다른 주문번호/],
    [{ ok: true, transaction: { ...tx, priceKrw: 1000 } }, /금액/],
    [{ ok: true, transaction: { ...tx, status: "CANCELED", rawStatus: "CANCEL" } }, /취소/],
  ];
  for (const [answer, expected] of refused) {
    calls.length = 0;
    gateway = answer;
    assert.match((await approve()).error ?? "", expected);
    assert.equal(calls.length, 0);
  }
  gateway = { ok: true, transaction: tx };

  // A settled or unknown attempt is refused before Inicis is asked.
  inquiries.length = 0;
  payment = { order_id: ORDER, amount_krw: 50000, status: "APPROVED", result_code: "0000" };
  assert.match((await approve()).error ?? "", /새로고침/);
  payment = null;
  assert.match((await approve()).error ?? "", /찾을 수 없습니다/);
  assert.match((await resolveUncertainCardPayment(db, { orderId: ORDER, actorUserId: "admin-fixture", outcome: "APPROVED", pgTid: "  " }, deps)).error ?? "", /TID/);
  assert.deepEqual(inquiries, []);
  assert.equal(calls.length, 0);

  // A failure confirmation reopens the order without an Inicis lookup.
  assert.deepEqual(await resolveUncertainCardPayment(db, { orderId: ORDER, actorUserId: "admin-fixture", outcome: "FAILED" }, deps), { submissionIds: [ID] });
  assert.deepEqual(calls, [{ method: "resolve_uncertain_submission_payment", args: { p_order_id: ORDER, p_actor_user_id: "admin-fixture", p_outcome: "FAILED", p_pg_tid: null, p_admin_memo: null } }]);
  assert.deepEqual(inquiries, []);
  for (const [message, expected] of [["PG_TID_REQUIRED", /TID/], ["GATEWAY_EVIDENCE_MISMATCH", /이니시스 조회 결과/], ["PAYMENT_NOT_UNCERTAIN", /새로고침/], ["ORDER_NOT_REVIEW_REQUIRED", /새로고침/], ["PAYMENT_NOT_FOUND", /찾을 수 없습니다/], ["boom", /저장하지 못했습니다/]] as const) {
    failure = { message };
    assert.match((await resolveUncertainCardPayment(db, { orderId: ORDER, actorUserId: "admin-fixture", outcome: "FAILED" })).error ?? "", expected);
  }
  failure = { code: "42501", message: "ADMIN_REQUIRED" };
  assert.match((await resolveUncertainCardPayment(db, { orderId: ORDER, actorUserId: "user", outcome: "FAILED" })).error ?? "", /관리자 권한/);
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
