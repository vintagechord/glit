import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";

import { buildStdPayRequest } from "../src/lib/inicis/stdpay";
import { requestStdPayApproval, requestStdPayNetCancel } from "../src/lib/inicis/api";
import { readBoundedInicisCallbackForm, validateInicisCallbackQuery } from "../src/lib/inicis/callback-request";
import { isTrustedStdPayUrl, parseInicisJson, validateStdPayCardReceipt } from "../src/lib/inicis/protocol";

const orderId = "SUBP-1792123456789-fixture";
const timestamp = "1792123456789";
const receipt = {
  resultCode: "0000", mid: "fixtureMID", MOID: orderId, TotPrice: "49000",
  tid: "StdpayCARD-fixture-transaction", currency: "WON", payMethod: "Card",
  applNum: "12345678", applDate: "20261016", applTime: "123456",
};
const expected = { mid: receipt.mid, orderId, amountKrw: 49000 };
const authUrl = "https://stgstdpay.inicis.com/api/payAuth";
const netCancelUrl = "https://stgstdpay.inicis.com/api/netCancel";
const parameters = { authUrl, netCancelUrl, authToken: "token+/=\r\n", timestamp, idcName: "stg", expectedOrderId: orderId, expectedAmountKrw: 49000 };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function config(t: TestContext) {
  t.mock.method(console, "info", () => undefined);
  const values = { INICIS_ENV: "stg", INICIS_MID_STG: receipt.mid, INICIS_SIGN_KEY_STG: "fixture-sign-key" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("STDPay form carries current security fields and UTF-8-safe labels", (t) => {
  config(t);
  const form = buildStdPayRequest({ orderId, amountKrw: 49000, productName: "음반심의상품".repeat(20), buyerName: "신청자".repeat(20), returnUrl: "https://onside.test/api/inicis/return" }, timestamp);
  assert.equal(form.use_chkfake, "Y");
  assert.equal(form.acceptmethod, "centerCd(Y)");
  assert.equal(form.charset, "UTF-8");
  assert.equal(form.signature, hash(`oid=${orderId}&price=49000&timestamp=${timestamp}`));
  assert.equal(form.verification, hash(`oid=${orderId}&price=49000&signKey=fixture-sign-key&timestamp=${timestamp}`));
  assert.ok(Buffer.byteLength(form.goodname) <= 40);
  assert.ok(Buffer.byteLength(form.buyername) <= 30);
  assert.doesNotMatch(form.goodname, /\ufffd/);
  for (const amountKrw of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => buildStdPayRequest({ orderId, amountKrw, productName: "심의", buyerName: "사용자", returnUrl: "https://onside.test" }));
});

test("server approval preserves the token and supplies verification over the exact bytes", async (t) => {
  config(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    requests++;
    assert.equal(String(url), authUrl);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("authToken"), parameters.authToken);
    assert.equal(body.get("signature"), hash(`authToken=${parameters.authToken}&timestamp=${timestamp}`));
    assert.equal(body.get("verification"), hash(`authToken=${parameters.authToken}&signKey=fixture-sign-key&timestamp=${timestamp}`));
    assert.equal(body.get("price"), "49000");
    return Response.json(receipt);
  });
  const result = await requestStdPayApproval(parameters);
  assert.equal(result.ok, true);
  assert.equal(validateStdPayCardReceipt(result.data!, expected), null);
  assert.equal(requests, 1);
});

test("only exact gateway environment, IDC and operation URLs are allowed", async (t) => {
  config(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("gateway must not be contacted"); });
  assert.equal(isTrustedStdPayUrl(authUrl, "stg", "stg"), true);
  assert.equal(isTrustedStdPayUrl("https://fcstdpay.inicis.com/api/payAuth", "fc", "prod"), true);
  for (const url of ["https://evil.inicis.com/api/payAuth", "https://stgstdpay.inicis.com:444/api/payAuth", `${authUrl}?token=1`, `${authUrl}#hash`, "https://user@stgstdpay.inicis.com/api/payAuth", "https://stgstdpay.inicis.com/x/../api/payAuth", "https://stgstdpay.inicis.com/api/netCancel", "https://ksstdpay.inicis.com/api/payAuth"]) {
    assert.equal(isTrustedStdPayUrl(url, "stg", "stg"), false, url);
    assert.equal((await requestStdPayApproval({ ...parameters, authUrl: url })).ok, false);
  }
  assert.equal(isTrustedStdPayUrl(authUrl, "fc", "stg"), false);
  assert.equal(isTrustedStdPayUrl(authUrl, undefined, "stg"), false);
  assert.equal(isTrustedStdPayUrl(authUrl, "stg", "prod"), false);
});

test("documented approval fields bind the exact receipt, independent of legacy authSignature", () => {
  assert.equal(validateStdPayCardReceipt(receipt, expected), null);
  assert.equal(validateStdPayCardReceipt({ ...receipt, authSignature: "legacy-not-an-authentication-proof" }, expected), null);
  const mutations = { resultCode: "00", mid: "otherMID", MOID: "other-order", TotPrice: "49,000", currency: "USD", payMethod: "VBank", tid: "", applNum: "", applDate: "20260230", applTime: "256000" };
  for (const [key, value] of Object.entries(mutations)) assert.notEqual(validateStdPayCardReceipt({ ...receipt, [key]: value }, expected), null, key);
});

test("malformed or duplicated gateway JSON cannot confirm success or a failed charge", async (t) => {
  config(t);
  assert.equal(parseInicisJson('{"resultCode":"0000","resultCode":"9999"}'), null);
  assert.equal(parseInicisJson('{"mid":"one","m\\u0069d":"two"}'), null);
  for (const value of ['{"a":[]}', '{"a":{}}', '{"a":true}', '{"a":1,}', '[]', '{"a":1e999}']) {
    const parsed = parseInicisJson(value);
    assert.ok(parsed === null || !Object.values(parsed).some(item => typeof item === "number" && !Number.isFinite(item)), value);
  }
  for (const body of ['', '{"resultCode":"0000","resultCode":"9999"}', '{"resultCode":"0000", "padding":"' + 'x'.repeat(70 * 1024) + '"}']) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(body));
    const result = await requestStdPayApproval({ ...parameters, skipNetCancel: true });
    assert.equal(result.ok, false);
    assert.equal(result.confirmedFailure, false);
    fetchMock.mock.restore();
  }
});

test("network cancellation requires the same merchant, order, and known transaction", async (t) => {
  config(t);
  for (const body of [{ resultCode: "0000" }, { ...receipt, MOID: "wrong-order" }, { ...receipt, tid: "other-transaction" }, receipt]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    const result = await requestStdPayNetCancel({ ...parameters, expectedTid: receipt.tid });
    assert.equal(result.ok, body === receipt);
    fetchMock.mock.restore();
  }
});

test("callback parsing rejects duplicate keys and invalid UTF-8 while preserving wrapped tokens", async () => {
  const request = (body: string) => new Request("https://onside.test/api/inicis/return", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  for (const body of ["authToken=first&authToken=second", "authToken=%FF", "authToken=%ZZ"]) assert.deepEqual(await readBoundedInicisCallbackForm(request(body)), { ok: false, reason: "invalid" });
  const parsed = await readBoundedInicisCallbackForm(request(new URLSearchParams({ authToken: parameters.authToken }).toString()));
  assert.equal(parsed.ok && parsed.form.get("authToken"), parameters.authToken);
  assert.deepEqual(validateInicisCallbackQuery("https://onside.test/?oid=one&oid=two"), { ok: false, reason: "invalid" });
});
