import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInicisMobileRequest,
  decodeInicisMobileMerchantData,
  encodeInicisMobileMerchantData,
  getInicisMobileNetCancelUrl,
  isTrustedInicisMobileRequestUrl,
  makeInicisMobileChkFake,
  parseInicisMobileResponse,
  requestInicisMobileApproval,
  requestInicisMobileNetCancel,
  validateInicisMobileCardReceipt,
} from "../src/lib/inicis/mobile";

const ORDER = "SUBP-1761900000000-abcdef12-12345678";
const STATE = "0f7b2f6e-7f41-4c2a-9c3e-3b2a1d4e5f60";

test("P_CHKFAKE follows the documented BASE64(SHA512(P_AMT+P_OID+P_TIMESTAMP+HashKey)) example", () => {
  // Worked example published in the KG Inicis INIpayMobile manual.
  assert.equal(
    makeInicisMobileChkFake({ amountKrw: 1000, orderId: "20150515208799704", timestamp: "1431678259", hashKey: "123456789012345678901234567890" }),
    "hE/Q+F//ZmnoGFNercEp6qyTaIuq7CLbrrUHtFWRKyktueQl97wjjISvqBB0aZC25b79YNs7bLxPT/hKMwySNA==",
  );
});

test("mobile request carries the required card fields and strips forbidden characters", () => {
  const { actionUrl, params } = buildInicisMobileRequest({
    actionUrl: "https://mobile.inicis.com/smart/payment/",
    mid: "onside0001",
    hashKey: "hash-key",
    orderId: ORDER,
    amountKrw: 49000,
    productName: "음반 심의: '타이틀' & \"B-side\"?\nline",
    buyerName: "홍길동",
    buyerEmail: "applicant+tag@example.com",
    buyerTel: "010-1234-5678 (대표)",
    nextUrl: "https://iamonside.com/api/inicis/mobile/return",
    merchantData: encodeInicisMobileMerchantData(ORDER, STATE),
    language: "en",
  }, "1761900000000");
  assert.equal(actionUrl, "https://mobile.inicis.com/smart/payment/");
  assert.equal(params.P_INI_PAYMENT, "CARD");
  assert.equal(params.P_MID, "onside0001");
  assert.equal(params.P_OID, ORDER);
  assert.equal(params.P_AMT, "49000");
  assert.equal(params.P_GOODS, "음반 심의 타이틀 B-side line");
  assert.equal(params.P_UNAME, "홍길동");
  assert.equal(params.P_NEXT_URL, "https://iamonside.com/api/inicis/mobile/return");
  assert.equal(params.P_NOTI, `${ORDER}_${STATE}`);
  assert.equal(params.P_RESERVED, "centerCd=Y&amt_hash=Y");
  assert.equal(params.P_CHARSET, "utf8");
  assert.equal(params.P_LANG, "en");
  assert.equal(params.P_TIMESTAMP, "1761900000000");
  assert.equal(params.P_CHKFAKE, makeInicisMobileChkFake({ amountKrw: 49000, orderId: ORDER, timestamp: "1761900000000", hashKey: "hash-key" }));
  // "+" is not allowed in P_EMAIL; the gateway field is optional so it is dropped.
  assert.equal(params.P_EMAIL, undefined);
  assert.equal(params.P_MOBILE, "010-1234-5678");
  assert.ok(Buffer.byteLength(params.P_GOODS, "utf8") <= 80);
});

test("mobile request rejects bad amounts, unsafe return URLs, and foreign gateways", () => {
  const base = {
    actionUrl: "https://mobile.inicis.com/smart/payment/", mid: "m", hashKey: "k", orderId: ORDER, amountKrw: 1000,
    productName: "x", buyerName: "y", nextUrl: "https://iamonside.com/api/inicis/mobile/return", merchantData: encodeInicisMobileMerchantData(ORDER, STATE),
  };
  assert.throws(() => buildInicisMobileRequest({ ...base, amountKrw: 0 }));
  assert.throws(() => buildInicisMobileRequest({ ...base, amountKrw: 123456789 }));
  assert.throws(() => buildInicisMobileRequest({ ...base, nextUrl: "http://iamonside.com/api/inicis/mobile/return" }));
  assert.throws(() => buildInicisMobileRequest({ ...base, actionUrl: "https://mobile.inicis.com.evil.test/smart/payment/" }));
  assert.throws(() => buildInicisMobileRequest({ ...base, hashKey: " " }));
  assert.throws(() => buildInicisMobileRequest({ ...base, merchantData: "has&ampersand" }));
});

test("merchant data round-trips the order id and close state", () => {
  const encoded = encodeInicisMobileMerchantData(ORDER, STATE);
  assert.deepEqual(decodeInicisMobileMerchantData(encoded), { orderId: ORDER, closeState: STATE });
  assert.equal(decodeInicisMobileMerchantData("no-separator"), null);
  assert.equal(decodeInicisMobileMerchantData(`${ORDER}_short`), null);
  assert.equal(decodeInicisMobileMerchantData(""), null);
  assert.equal(decodeInicisMobileMerchantData("a&b_" + STATE), null);
});

test("only the documented approval hosts for the returned IDC centre are trusted", () => {
  assert.equal(isTrustedInicisMobileRequestUrl("https://fcmobile.inicis.com/smart/payReq.ini", "fc", "prod"), true);
  assert.equal(isTrustedInicisMobileRequestUrl("https://ksmobile.inicis.com/smart/payReq.ini", "ks", "prod"), true);
  assert.equal(isTrustedInicisMobileRequestUrl("https://stgmobile.inicis.com/smart/payReq.ini", "stg", "stg"), true);
  assert.equal(isTrustedInicisMobileRequestUrl("https://stgmobile.inicis.com/smart/payReq.ini", "stg", "prod"), false);
  assert.equal(isTrustedInicisMobileRequestUrl("https://fcmobile.inicis.com/smart/payReq.ini", "ks", "prod"), false);
  assert.equal(isTrustedInicisMobileRequestUrl("https://fcmobile.inicis.com.evil.test/smart/payReq.ini", "fc", "prod"), false);
  assert.equal(isTrustedInicisMobileRequestUrl("http://fcmobile.inicis.com/smart/payReq.ini", "fc", "prod"), false);
  assert.equal(isTrustedInicisMobileRequestUrl("https://fcmobile.inicis.com/smart/payNetCancel.ini", "fc", "prod"), false);
  assert.equal(getInicisMobileNetCancelUrl("https://ksmobile.inicis.com/smart/payReq.ini"), "https://ksmobile.inicis.com/smart/payNetCancel.ini");
});

test("approval responses parse as UTF-8 or EUC-KR key=value text", () => {
  const utf8 = new TextEncoder().encode(`P_STATUS=00&P_RMESG1=${encodeURIComponent("정상 승인")}&P_TID=INIMX_CARDonside0001&P_AMT=49000`);
  // The parser returns a prototype-less record; compare the entries.
  assert.deepEqual({ ...parseInicisMobileResponse(utf8) }, { P_STATUS: "00", P_RMESG1: "정상 승인", P_TID: "INIMX_CARDonside0001", P_AMT: "49000" });
  // "결제" in EUC-KR is B0 E1 C1 A6.
  const eucKr = new Uint8Array([...new TextEncoder().encode("P_STATUS=01&P_RMESG1="), 0xb0, 0xe1, 0xc1, 0xa6]);
  assert.deepEqual({ ...parseInicisMobileResponse(eucKr) }, { P_STATUS: "01", P_RMESG1: "결제" });
  assert.equal(parseInicisMobileResponse(new TextEncoder().encode("<html>error</html>")), null);
  assert.equal(parseInicisMobileResponse(new TextEncoder().encode("P_STATUS=00&P_STATUS=01")), null);
});

const receipt = () => ({
  P_STATUS: "00", P_MID: "onside0001", P_OID: ORDER, P_AMT: "49000", P_TYPE: "CARD",
  P_TID: "INIMX_CARDonside000120261031120000000001", P_AUTH_DT: "20261031120000", P_AUTH_NO: "12345678",
});

test("mobile receipts must match the stored order exactly", () => {
  const expected = { mid: "onside0001", orderId: ORDER, amountKrw: 49000 };
  assert.equal(validateInicisMobileCardReceipt(receipt(), expected), null);
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_STATUS: "01" }, expected), "RESULT_CODE_MISMATCH");
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_MID: "other" }, expected), "MID_MISMATCH");
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_OID: "SUBP-other" }, expected), "ORDER_ID_MISMATCH");
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_AMT: "48000" }, expected), "PRICE_MISMATCH");
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_TYPE: "BANK" }, expected), "PAYMENT_METHOD_MISMATCH");
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_TID: "x" }, expected), "TID_MISSING");
  assert.equal(validateInicisMobileCardReceipt({ ...receipt(), P_AUTH_DT: "20261331120000" }, expected), "APPROVAL_DATE_INVALID");
});

const textResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

test("approval request posts only P_MID and P_TID to the verified URL and reports final rejections", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body) });
    return textResponse("P_STATUS=00&P_TID=INIMX_CARDonside000120261031120000000001&P_OID=" + ORDER + "&P_AMT=49000&P_TYPE=CARD&P_MID=onside0001&P_AUTH_DT=20261031120000");
  }) as typeof fetch;
  const ok = await requestInicisMobileApproval({ requestUrl: "https://fcmobile.inicis.com/smart/payReq.ini", idcName: "fc", mode: "prod", mid: "onside0001", authTid: "INIMX_AUTHonside0001" }, fetcher);
  assert.equal(ok.ok, true);
  assert.equal(ok.data?.P_TID, "INIMX_CARDonside000120261031120000000001");
  assert.deepEqual(calls, [{ url: "https://fcmobile.inicis.com/smart/payReq.ini", body: "P_MID=onside0001&P_TID=INIMX_AUTHonside0001" }]);

  const rejected = await requestInicisMobileApproval({ requestUrl: "https://fcmobile.inicis.com/smart/payReq.ini", idcName: "fc", mode: "prod", mid: "onside0001", authTid: "INIMX_AUTHonside0001" },
    (async () => textResponse("P_STATUS=V033&P_RMESG1=declined")) as typeof fetch);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.confirmedFailure, true);

  const timeout = await requestInicisMobileApproval({ requestUrl: "https://fcmobile.inicis.com/smart/payReq.ini", idcName: "fc", mode: "prod", mid: "onside0001", authTid: "INIMX_AUTHonside0001" },
    (async () => { throw new Error("socket hang up"); }) as typeof fetch);
  assert.equal(timeout.ok, false);
  assert.equal(timeout.confirmedFailure, false);

  const untrusted = await requestInicisMobileApproval({ requestUrl: "https://evil.test/smart/payReq.ini", idcName: "fc", mode: "prod", mid: "onside0001", authTid: "INIMX_AUTHonside0001" },
    (async () => { assert.fail("must not call an untrusted host"); }) as typeof fetch);
  assert.equal(untrusted.ok, false);
});

test("net cancel signs the documented fields and only trusts a matching order", async () => {
  let body = "";
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://ksmobile.inicis.com/smart/payNetCancel.ini");
    body = String(init?.body);
    return textResponse(`P_STATUS=00&P_OID=${ORDER}`);
  }) as typeof fetch;
  const result = await requestInicisMobileNetCancel({
    requestUrl: "https://ksmobile.inicis.com/smart/payReq.ini", idcName: "ks", mode: "prod", mid: "onside0001",
    authTid: "INIMX_AUTHonside0001", orderId: ORDER, amountKrw: 49000, hashKey: "hash-key",
  }, fetcher, "1761900000000");
  assert.equal(result.ok, true);
  const params = new URLSearchParams(body);
  assert.equal(params.get("P_TID"), "INIMX_AUTHonside0001");
  assert.equal(params.get("P_MID"), "onside0001");
  assert.equal(params.get("P_AMT"), "49000");
  assert.equal(params.get("P_OID"), ORDER);
  assert.equal(params.get("P_TIMESTAMP"), "1761900000000");
  assert.equal(params.get("P_CHKFAKE"), makeInicisMobileChkFake({ amountKrw: 49000, orderId: ORDER, timestamp: "1761900000000", hashKey: "hash-key" }));

  const mismatch = await requestInicisMobileNetCancel({
    requestUrl: "https://ksmobile.inicis.com/smart/payReq.ini", idcName: "ks", mode: "prod", mid: "onside0001",
    authTid: "INIMX_AUTHonside0001", orderId: ORDER, amountKrw: 49000, hashKey: "hash-key",
  }, (async () => textResponse("P_STATUS=00&P_OID=SUBP-other")) as typeof fetch, "1761900000000");
  assert.equal(mismatch.ok, false);
});
