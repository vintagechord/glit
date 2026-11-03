import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";

import { handleInicisMobileReturn, type InicisMobileReturnDeps } from "../src/app/api/inicis/mobile/return/handler";

const SUBMISSION = "20000000-0000-4000-8000-000000000001";
const ORDER = "SUBP-1761900000000-20000000-abcdef12";
const STATE = "30000000-0000-4000-8000-000000000001";
const REQ_URL = "https://stgmobile.inicis.com/smart/payReq.ini";
const receipt = () => ({
  P_STATUS: "00", P_MID: "fixture-mid", P_OID: ORDER, P_AMT: "49000", P_TYPE: "CARD",
  P_TID: "INIMX_CARDfixture00120261031120000000001", P_AUTH_DT: "20261031120000", P_RMESG1: "정상 승인",
});

type Calls = Array<{ method: string; args?: unknown }>;

function harness(overrides: Partial<{
  paymentStatus: string; channel: string; claim: "fresh" | "processing" | "approved" | "invalid";
  approval: { ok: boolean; data: Record<string, string> | null; confirmedFailure: boolean } | "throw";
  cancelOk: boolean; persistOk: boolean; guestToken: string | null; hashKey: string | null;
}> = {}) {
  const calls: Calls = [];
  const options = { paymentStatus: "REQUESTED", channel: "mobile", claim: "fresh" as const, approval: { ok: true, data: receipt(), confirmedFailure: false }, cancelOk: true, persistOk: true, guestToken: "guest-fixture-token", hashKey: "hash-key", ...overrides };
  const deps: InicisMobileReturnDeps = {
    getConfig: () => ({ mid: "fixture-mid", env: "stg" }),
    getHashKey: () => options.hashKey,
    getPaymentByOrderId: (async () => ({
      payment: { status: options.paymentStatus, amount_krw: 49000, submission_id: SUBMISSION,
        raw_response: { closeState: STATE, channel: options.channel, paymentGroup: { submissionIds: [SUBMISSION] } },
        submission: { id: SUBMISSION, guest_token: options.guestToken } },
      error: null,
    })) as unknown as InicisMobileReturnDeps["getPaymentByOrderId"],
    claim: async (orderId, callbackState) => {
      calls.push({ method: "claim", args: { orderId, callbackState } });
      if (options.claim === "invalid") return null;
      return { alreadyApproved: options.claim === "approved", alreadyProcessing: options.claim === "processing" };
    },
    settle: async (input) => { calls.push({ method: "settle", args: input }); return true; },
    markPaymentSuccess: (async (orderId: string, payload: unknown) => {
      calls.push({ method: "paid", args: { orderId, payload } });
      return { ok: options.persistOk, error: options.persistOk ? null : new Error("lost"), submissionId: SUBMISSION };
    }) as InicisMobileReturnDeps["markPaymentSuccess"],
    markPaymentFailure: (async (orderId: string, payload: unknown) => { calls.push({ method: "failure", args: { orderId, payload } }); return { ok: true, error: null }; }) as InicisMobileReturnDeps["markPaymentFailure"],
    markPaymentCanceled: (async (orderId: string, payload: unknown) => { calls.push({ method: "canceled", args: { orderId, payload } }); return { ok: true, error: null, submissionId: SUBMISSION, guestToken: null }; }) as InicisMobileReturnDeps["markPaymentCanceled"],
    approve: (async (params: unknown) => {
      calls.push({ method: "approve", args: params });
      if (options.approval === "throw") throw new Error("network");
      return options.approval;
    }) as InicisMobileReturnDeps["approve"],
    netCancel: (async (params: unknown) => { calls.push({ method: "netCancel", args: params }); return { ok: options.cancelOk, data: { P_STATUS: options.cancelOk ? "00" : "99" } }; }) as InicisMobileReturnDeps["netCancel"],
    notify: (async (input: unknown) => { calls.push({ method: "notify", args: input }); return { ok: true }; }) as unknown as InicisMobileReturnDeps["notify"],
    createGrant: (() => "fixture-grant") as InicisMobileReturnDeps["createGrant"],
    setGrantCookie: ((response: { cookies: { set: (name: string, value: string) => void } }) => { calls.push({ method: "grant" }); response.cookies.set("payment_result", "fixture-grant"); }) as InicisMobileReturnDeps["setGrantCookie"],
    skipNetCancel: () => false,
  };
  return { deps, calls };
}

const params = (overrides: Record<string, string> = {}) => new URLSearchParams({
  P_STATUS: "00", P_RMESG1: "OK", P_TID: "INIMX_AUTHfixture001", P_AMT: "49000", idc_name: "stg", P_REQ_URL: REQ_URL,
  P_NOTI: `${ORDER}_${STATE}`, ...overrides,
});
const post = (body = params()) => new NextRequest("https://iamonside.com/api/inicis/mobile/return", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
});
const silence = (t: TestContext) => {
  t.mock.method(console, "info", () => undefined);
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);
};
const location = (response: Response) => new URL(response.headers.get("location") ?? "");

test("a verified mobile authentication result is claimed, approved against the trusted URL, persisted and bridged", async (t) => {
  silence(t);
  const { deps, calls } = harness();
  const response = await handleInicisMobileReturn(post(), deps);
  assert.equal(response.status, 303);
  const target = location(response);
  assert.equal(target.pathname, "/pay/inicis/return");
  assert.equal(target.searchParams.get("status"), "SUCCESS");
  assert.equal(target.searchParams.get("submissionId"), SUBMISSION);
  assert.equal(target.searchParams.get("submissionIds"), SUBMISSION);
  assert.ok(!target.search.includes("guest-fixture-token"));
  assert.deepEqual(calls.map((call) => call.method), ["claim", "approve", "paid", "grant"]);
  const approve = calls[1].args as { requestUrl: string; mid: string; authTid: string; mode: string };
  assert.deepEqual(approve, { requestUrl: REQ_URL, idcName: "stg", mode: "stg", mid: "fixture-mid", authTid: "INIMX_AUTHfixture001" });
  const paid = calls[2].args as { payload: { tid: string; raw_response: Record<string, unknown> } };
  assert.equal(paid.payload.tid, receipt().P_TID);
  assert.equal(JSON.stringify(paid.payload.raw_response).includes("P_CARD_NUM"), false);
  assert.ok(response.headers.get("set-cookie")?.includes("payment_result"));
});

test("GET delivery of the authentication result is accepted", async (t) => {
  silence(t);
  const { deps, calls } = harness();
  const response = await handleInicisMobileReturn(new NextRequest(`https://iamonside.com/api/inicis/mobile/return?${params()}`), deps);
  assert.equal(location(response).searchParams.get("status"), "SUCCESS");
  assert.deepEqual(calls.map((call) => call.method), ["claim", "approve", "paid", "grant"]);
});

test("authentication failures and cancellations close the attempt without any gateway call", async (t) => {
  silence(t);
  // A customer cancel is the same CANCELED attempt as closing the PC window
  // (the order then reads "결제 대기"); a rejection is a FAILED attempt.
  for (const [status, message, expected, method] of [
    ["01", "사용자 취소", "CANCEL", "canceled"], ["V001", "결제를 취소하였습니다", "CANCEL", "canceled"], ["V033", "card declined", "FAIL", "failure"],
  ] as const) {
    const { deps, calls } = harness();
    const response = await handleInicisMobileReturn(post(params({ P_STATUS: status, P_RMESG1: message, P_TID: "" })), deps);
    assert.equal(location(response).searchParams.get("status"), expected);
    assert.deepEqual(calls.map((call) => call.method), [method]);
    const payload = (calls[0].args as { payload: { result_code: string; close_state?: string } }).payload;
    assert.equal(payload.result_code, status);
    if (method === "canceled") assert.equal(payload.close_state, STATE, "the authenticated close state binds the cancel");
  }
});

test("untrusted approval URLs, wrong amounts, foreign channels and bad merchant data never reach the gateway", async (t) => {
  silence(t);
  const cases: Array<[Record<string, string>, Partial<Parameters<typeof harness>[0]>, string[]]> = [
    [{ P_REQ_URL: "https://stgmobile.inicis.com.evil.test/smart/payReq.ini" }, {}, ["failure"]],
    [{ idc_name: "fc" }, {}, ["failure"]],
    [{ P_AMT: "48000" }, {}, ["failure"]],
    [{}, { channel: "pc" }, []],
    [{ P_NOTI: "garbage" }, {}, []],
    [{ P_NOTI: `${ORDER}_${STATE.slice(0, -1)}f` }, {}, []],
  ];
  for (const [overrides, options, expectedCalls] of cases) {
    const { deps, calls } = harness(options);
    const response = await handleInicisMobileReturn(post(params(overrides)), deps);
    assert.equal(location(response).searchParams.get("status"), "FAIL");
    assert.deepEqual(calls.map((call) => call.method), expectedCalls, JSON.stringify(overrides));
  }
});

test("replayed results for an approved payment only repair notifications", async (t) => {
  silence(t);
  const { deps, calls } = harness({ paymentStatus: "APPROVED" });
  const response = await handleInicisMobileReturn(post(), deps);
  assert.equal(location(response).searchParams.get("status"), "SUCCESS");
  assert.deepEqual(calls.map((call) => call.method), ["notify"]);
});

test("concurrent or invalid claims stop before the gateway", async (t) => {
  silence(t);
  // A concurrent result for an attempt still being approved may already be
  // charged: the customer is told the payment is being checked, not failed.
  for (const [claim, status] of [["processing", "CHECKING"], ["invalid", "ERROR"], ["approved", "SUCCESS"]] as const) {
    const { deps, calls } = harness({ claim });
    const response = await handleInicisMobileReturn(post(), deps);
    assert.equal(location(response).searchParams.get("status"), status);
    assert.ok(!calls.some((call) => call.method === "approve"));
  }
});

test("a gateway rejection settles as a confirmed failure; unknown outcomes net-cancel first", async (t) => {
  silence(t);
  const rejected = harness({ approval: { ok: false, data: { P_STATUS: "V033", P_RMESG1: "declined" }, confirmedFailure: true } });
  assert.equal(location(await handleInicisMobileReturn(post(), rejected.deps)).searchParams.get("status"), "FAIL");
  assert.deepEqual(rejected.calls.map((call) => call.method), ["claim", "approve", "settle"]);
  assert.equal((rejected.calls[2].args as { confirmedFailure: boolean; resultCode: string }).confirmedFailure, true);
  assert.equal((rejected.calls[2].args as { resultCode: string }).resultCode, "V033");

  const cancelled = harness({ approval: "throw", cancelOk: true });
  assert.equal(location(await handleInicisMobileReturn(post(), cancelled.deps)).searchParams.get("status"), "FAIL");
  assert.deepEqual(cancelled.calls.map((call) => call.method), ["claim", "approve", "netCancel", "settle"]);
  assert.equal((cancelled.calls[3].args as { confirmedFailure: boolean }).confirmedFailure, true);

  const uncertain = harness({ approval: "throw", cancelOk: false });
  assert.equal(location(await handleInicisMobileReturn(post(), uncertain.deps)).searchParams.get("status"), "CHECKING");
  assert.deepEqual(uncertain.calls.map((call) => call.method), ["claim", "approve", "netCancel", "settle"]);
  assert.equal((uncertain.calls[3].args as { confirmedFailure: boolean }).confirmedFailure, false);

  const noKey = harness({ approval: "throw", hashKey: null });
  assert.equal(location(await handleInicisMobileReturn(post(), noKey.deps)).searchParams.get("status"), "CHECKING");
  assert.deepEqual(noKey.calls.map((call) => call.method), ["claim", "approve", "settle"]);
  assert.equal((noKey.calls[2].args as { confirmedFailure: boolean }).confirmedFailure, false);

  const mismatchUncancelled = harness({ approval: { ok: true, data: { ...receipt(), P_AMT: "1000" }, confirmedFailure: false }, cancelOk: false });
  assert.equal(location(await handleInicisMobileReturn(post(), mismatchUncancelled.deps)).searchParams.get("status"), "CHECKING");
});

test("an exception after the claim reports CHECKING and keeps the attempt for reconciliation", async (t) => {
  silence(t);
  const { deps, calls } = harness();
  deps.markPaymentSuccess = (async () => { throw new Error("database connection reset"); }) as InicisMobileReturnDeps["markPaymentSuccess"];
  const target = location(await handleInicisMobileReturn(post(), deps));
  assert.equal(target.searchParams.get("status"), "CHECKING");
  assert.equal(target.searchParams.get("submissionId"), SUBMISSION);
  const settle = calls.find((call) => call.method === "settle")?.args as { confirmedFailure: boolean; resultCode: string };
  assert.deepEqual([settle.confirmedFailure, settle.resultCode], [false, "APPROVAL_EXCEPTION"]);
});

test("an approved receipt that does not match the order is net-cancelled and failed", async (t) => {
  silence(t);
  const { deps, calls } = harness({ approval: { ok: true, data: { ...receipt(), P_AMT: "1000" }, confirmedFailure: false } });
  const response = await handleInicisMobileReturn(post(), deps);
  assert.equal(location(response).searchParams.get("status"), "FAIL");
  assert.deepEqual(calls.map((call) => call.method), ["claim", "approve", "netCancel", "settle"]);
  assert.equal((calls[3].args as { resultCode: string }).resultCode, "PRICE_MISMATCH");
  assert.equal((calls[3].args as { confirmedFailure: boolean }).confirmedFailure, true);
});

test("a lost database response after approval keeps the charge for reconciliation", async (t) => {
  silence(t);
  const { deps, calls } = harness({ persistOk: false });
  const response = await handleInicisMobileReturn(post(), deps);
  assert.equal(location(response).searchParams.get("status"), "CHECKING", "a charged customer must not read this as a failure");
  assert.deepEqual(calls.map((call) => call.method), ["claim", "approve", "paid", "settle", "grant"]);
  const settle = calls[3].args as { confirmedFailure: boolean; resultCode: string };
  assert.equal(settle.confirmedFailure, false);
  assert.equal(settle.resultCode, "PERSIST_FAIL");
  assert.ok(!calls.some((call) => call.method === "netCancel"));
});

test("oversized or malformed callbacks are rejected before any lookup", async (t) => {
  silence(t);
  const { deps, calls } = harness();
  const big = new URLSearchParams(params());
  big.set("P_RMESG1", "x".repeat(9_000));
  const response = await handleInicisMobileReturn(post(big), deps);
  assert.equal(response.status, 413);
  assert.deepEqual(calls, []);
});
