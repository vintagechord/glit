import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  buildInicisInquiryRequest,
  inquireInicisTransaction,
  inicisApprovalEvidence,
  parseInicisInquiryResponse,
  verifyInicisApprovalForOrder,
} from "../src/lib/inicis/transaction-inquiry";

// Public INIAPI test values (KG Inicis INIpayTest), never production keys.
const config = { mid: "INIpayTest", apiKey: "ItEQKi3rY7uvDS8l", apiIv: "HYb3yQ4f65QL89==", apiUrl: "https://stginiapi.inicis.com" };
const TID = "StdpayCARDINIpayTest20261126101010123456";
const ORDER = "SUB-1764120000000-abcd1234";

const approvedBody = {
  resultCode: "SUCCESS", resultMsg: "정상처리", tid: TID, mid: "INIpayTest", oid: ORDER, price: "50000",
  paymethod: "Card", approvedDate: "20261126", approvedTime: "101010", transactionStatus: "APPROVAL",
  cardInfo: { approvedNumber: "30012345", cardName: "국민" },
};

const jsonFetch = (body: unknown, status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

test("the inquiry request is INIAPI v2 inquiry, hashed over the compact JSON of data", () => {
  const request = buildInicisInquiryRequest(config, TID, "20261126101010", "127.0.0.1");
  assert.deepEqual(request.data, { tid: TID });
  assert.equal(request.type, "inquiry");
  assert.equal(request.mid, "INIpayTest");
  const expected = createHash("sha512").update(`${config.apiKey}INIpayTestinquiry20261126101010{"tid":"${TID}"}`).digest("hex");
  assert.equal(request.hashData, expected);
});

test("an approved transaction is read from the top-level fields", () => {
  const parsed = parseInicisInquiryResponse(approvedBody);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.transaction, {
    tid: TID, oid: ORDER, mid: "INIpayTest", priceKrw: 50000, status: "APPROVED", rawStatus: "APPROVAL",
    payMethod: "Card", approvedNumber: "30012345", approvedAt: "2026-11-26T01:10:10.000Z",
  });
  // Some INIAPI responses nest the result under data.
  const nested = parseInicisInquiryResponse({ resultCode: "SUCCESS", data: { ...approvedBody, resultCode: undefined } });
  assert.equal(nested.ok && nested.transaction.priceKrw, 50000);
});

test("inquiry failures and unreadable answers are never treated as approvals", () => {
  const notFound = parseInicisInquiryResponse({ resultCode: "FAIL", resultMsg: "NOT_FOUND_PAYMENT" });
  assert.equal(notFound.ok, false);
  assert.match(!notFound.ok ? notFound.message : "", /거래가 없습니다/);
  const badHash = parseInicisInquiryResponse({ resultCode: "ER0400", resultMsg: "해시 데이터가 일치하지 않습니다." });
  assert.match(!badHash.ok ? badHash.message : "", /INIAPI/);
  for (const body of [
    { ...approvedBody, tid: "" },
    { ...approvedBody, oid: undefined },
    { ...approvedBody, price: "5만" },
    { ...approvedBody, transactionStatus: undefined },
  ]) {
    assert.equal(parseInicisInquiryResponse(body).ok, false, JSON.stringify(body));
  }
});

test("only an approved, uncancelled transaction for this order number and amount passes", () => {
  const parsed = parseInicisInquiryResponse(approvedBody);
  assert.ok(parsed.ok);
  const tx = parsed.transaction;
  const expected = { tid: TID, orderId: ORDER, amountKrw: 50000 };
  assert.equal(verifyInicisApprovalForOrder(tx, expected), null);
  assert.match(verifyInicisApprovalForOrder({ ...tx, oid: "SUB-other" }, expected) ?? "", /다른 주문번호/);
  assert.match(verifyInicisApprovalForOrder({ ...tx, priceKrw: 100 }, expected) ?? "", /금액/);
  assert.match(verifyInicisApprovalForOrder({ ...tx, tid: "StdpayCARDother000001" }, expected) ?? "", /TID/);
  assert.match(verifyInicisApprovalForOrder({ ...tx, status: "CANCELED", rawStatus: "CANCEL" }, expected) ?? "", /취소/);
  assert.match(verifyInicisApprovalForOrder({ ...tx, status: "PARTIAL_CANCELED", rawStatus: "PART_CANCEL" }, expected) ?? "", /부분취소/);
  assert.match(verifyInicisApprovalForOrder({ ...tx, status: "OTHER", rawStatus: "NON_DEPOSIT" }, expected) ?? "", /승인 상태가 아닙니다/);
  // The legacy status codes map the same way.
  const legacy = parseInicisInquiryResponse({ ...approvedBody, transactionStatus: undefined, status: "1" });
  assert.ok(legacy.ok);
  assert.match(verifyInicisApprovalForOrder(legacy.transaction, expected) ?? "", /취소/);
});

test("the approval evidence records what Inicis returned for the database check", () => {
  const parsed = parseInicisInquiryResponse(approvedBody);
  assert.ok(parsed.ok);
  const evidence = inicisApprovalEvidence(parsed.transaction, new Date("2026-11-26T01:20:00Z"));
  assert.deepEqual(evidence, {
    source: "INIAPI_V2_INQUIRY", tid: TID, oid: ORDER, mid: "INIpayTest", priceKrw: 50000, status: "APPROVED",
    transactionStatus: "APPROVAL", payMethod: "Card", approvedNumber: "30012345", approvedAt: "2026-11-26T01:10:10.000Z",
    checkedAt: "2026-11-26T01:20:00.000Z",
  });
});

test("the inquiry posts JSON to the configured INIAPI host and checks the merchant", async () => {
  const ok = jsonFetch(approvedBody);
  const result = await inquireInicisTransaction(TID, { config, fetchImpl: ok.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(ok.calls[0].url, "https://stginiapi.inicis.com/v2/pg/inquiry");
  assert.equal(ok.calls[0].init.method, "POST");
  const sent = JSON.parse(String(ok.calls[0].init.body));
  assert.deepEqual(sent.data, { tid: TID });
  assert.equal(sent.type, "inquiry");

  const otherMerchant = await inquireInicisTransaction(TID, { config, fetchImpl: jsonFetch({ ...approvedBody, mid: "OTHERMID01" }).fetchImpl });
  assert.match(!otherMerchant.ok ? otherMerchant.message : "", /상점/);

  const notConfigured = await inquireInicisTransaction(TID, { config: null });
  assert.equal(!notConfigured.ok && notConfigured.code, "NOT_CONFIGURED");

  const offline = await inquireInicisTransaction(TID, { config, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
  assert.equal(!offline.ok && offline.code, "NETWORK_ERROR");

  const garbage = await inquireInicisTransaction(TID, { config, fetchImpl: jsonFetch("<html>", 502).fetchImpl });
  assert.equal(garbage.ok, false);

  const malformedTid = await inquireInicisTransaction("bad tid!", { config, fetchImpl: ok.fetchImpl });
  assert.equal(!malformedTid.ok && malformedTid.code, "INVALID_TID");
});
