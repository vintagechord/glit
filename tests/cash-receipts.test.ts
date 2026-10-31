import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import test from "node:test";

import {
  isCashReceiptEditable,
  isValidBusinessNumber,
  maskCashReceiptIdentifier,
  splitVatInclusiveAmount,
  validateCashReceiptRequest,
} from "../src/lib/cash-receipts";
import { buildCashReceiptIssueRequest, issueCashReceiptWithInicis } from "../src/lib/inicis/cash-receipt";
import { generateCashReceiptPdf } from "../src/lib/cash-receipt-pdf";
import { saveCashReceiptRequest } from "../src/lib/cash-receipts-server";

const config = { mid: "INIpayTest", apiKey: "ItEQKi3rY7uvDS8l", apiIv: "HYb3yQ4f65QL89==", apiUrl: "https://stginiapi.inicis.com" };
const issueInput = {
  totalKrw: 55000, supplyKrw: 50000, vatKrw: 5000, purpose: "EXPENSE_PROOF" as const, identifier: "7488801472",
  goodName: "음반 심의 · 테스트", buyerName: "홍길동", buyerEmail: "buyer@example.invalid", buyerTel: "010-1234-5678",
};

test("cash receipt identifiers follow the purpose", () => {
  assert.deepEqual(validateCashReceiptRequest({ purpose: "INCOME_DEDUCTION", identifier: "010-1234-5678" }),
    { ok: true, value: { purpose: "INCOME_DEDUCTION", identifier: "01012345678" } });
  assert.equal(validateCashReceiptRequest({ purpose: "INCOME_DEDUCTION", identifier: "1234567890123456" }).ok, true);
  assert.equal(validateCashReceiptRequest({ purpose: "INCOME_DEDUCTION", identifier: "02-123-4567" }).ok, false);
  assert.equal(validateCashReceiptRequest({ purpose: "EXPENSE_PROOF", identifier: "748-88-01472" }).ok, true);
  assert.equal(validateCashReceiptRequest({ purpose: "EXPENSE_PROOF", identifier: "748-88-01473" }).ok, false);
  assert.equal(validateCashReceiptRequest({ purpose: "EXPENSE_PROOF", identifier: "abc" }).ok, false);
  assert.equal(validateCashReceiptRequest({ purpose: "OTHER", identifier: "01012345678" }).ok, false);
  assert.equal(isValidBusinessNumber("7488801472"), true);
  assert.equal(isValidBusinessNumber("1234567890"), false);
});

test("identifiers are masked and VAT-inclusive totals split into supply and VAT", () => {
  assert.equal(maskCashReceiptIdentifier("01012345678"), "010-****-5678");
  assert.equal(maskCashReceiptIdentifier("7488801472"), "748-**-*1472");
  assert.deepEqual(splitVatInclusiveAmount(55000), { totalKrw: 55000, supplyKrw: 50000, vatKrw: 5000 });
  assert.deepEqual(splitVatInclusiveAmount(50000), { totalKrw: 50000, supplyKrw: 45455, vatKrw: 4545 });
  assert.deepEqual(splitVatInclusiveAmount(0), { totalKrw: 0, supplyKrw: 0, vatKrw: 0 });
  assert.equal(isCashReceiptEditable("REQUESTED"), true);
  assert.equal(isCashReceiptEditable("ISSUING"), false);
  assert.equal(isCashReceiptEditable("ISSUED"), false);
});

test("the Inicis request encrypts the identifier and signs the exact data JSON", () => {
  const body = buildCashReceiptIssueRequest(config, issueInput, "20261101004746", "127.0.0.1");
  assert.equal(body.type, "receipt");
  assert.equal(body.data.issueType, "1");
  assert.equal(body.data.buyerTel, "01012345678");
  const decipher = createDecipheriv("aes-128-cbc", Buffer.from(config.apiKey), Buffer.from(config.apiIv));
  assert.equal(Buffer.concat([decipher.update(body.data.issueNumber, "base64"), decipher.final()]).toString(), "7488801472");
  const expected = createHash("sha512").update(config.apiKey + config.mid + "receipt" + "20261101004746" + JSON.stringify(body.data)).digest("hex");
  assert.equal(body.hashData, expected);
  assert.equal(buildCashReceiptIssueRequest(config, { ...issueInput, purpose: "INCOME_DEDUCTION" }).data.issueType, "0");
});

test("Inicis responses map to issued, rejected and uncertain outcomes", async () => {
  const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const issued = await issueCashReceiptWithInicis(issueInput, { config, fetchImpl: reply({ resultCode: "00", tid: "TID1", authNumber: "269620648", authDate: "20261101", authTime: "004746" }) });
  assert.equal(issued.ok, true);
  if (issued.ok) {
    assert.equal(issued.approvalNumber, "269620648");
    assert.equal(issued.issuedAt, "2026-10-31T15:47:46.000Z");
  }
  const rejected = await issueCashReceiptWithInicis(issueInput, { config, fetchImpl: reply({ resultCode: "ER0400", resultMsg: "해시 데이터가 일치하지 않습니다." }) });
  assert.deepEqual(rejected.ok ? null : [rejected.uncertain, rejected.code], [false, "ER0400"]);
  const offline = await issueCashReceiptWithInicis(issueInput, { config, fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
  assert.equal(!offline.ok && offline.uncertain, true);
  const missing = await issueCashReceiptWithInicis(issueInput, { config: null });
  assert.equal(!missing.ok && missing.code, "NOT_CONFIGURED");
});

test("the receipt PDF embeds Korean text", async () => {
  const bytes = await generateCashReceiptPdf({
    orderId: "3f1c2b8e-1d2a-4c6b-9a7e-5b2d1e0f9a11", purpose: "INCOME_DEDUCTION", identifier: "01012345678",
    approvalNumber: "269620646", issuedAt: "2026-10-31T15:47:46.000Z", issueMethod: "MANUAL",
    amountKrw: 1100, supplyKrw: 1000, vatKrw: 100, goodName: "음반 심의 · 테스트",
    business: { name: "(주)빈티지하우스", representative: "정준영", registrationNumber: "748-88-01472", address: "김포", phone: "010-0000-0000" },
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 100_000 && bytes.length < 4 * 1024 * 1024, "full Korean fonts stay under the response limit");
});

function fakeDb(existing: Record<string, unknown> | null) {
  const calls: string[] = [];
  const builder = (table: string) => {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (op === "select") return { data: existing ? [existing] : [], error: null };
      calls.push(`${table}:${op}`);
      return { data: op === "delete" ? null : { order_id: "o1", purpose: "INCOME_DEDUCTION", identifier: "01012345678", status: "REQUESTED", requested_at: "2026-11-01T00:00:00Z" }, error: null };
    };
    for (const name of ["select", "in", "eq"]) chain[name] = () => chain;
    for (const name of ["insert", "update", "delete"]) chain[name] = () => { op = name; return chain; };
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return chain;
  };
  return { db: { from: builder } as never, calls };
}

test("customers may request receipts only for open bank orders and never overwrite an issued one", async () => {
  const request = { purpose: "INCOME_DEDUCTION" as const, identifier: "01012345678" };
  const card = await saveCashReceiptRequest(fakeDb(null).db, { id: "o1", payment_method: "CARD", status: "PAID" }, request);
  assert.deepEqual(card.ok ? null : card.status, 400);
  const refunded = await saveCashReceiptRequest(fakeDb(null).db, { id: "o1", payment_method: "BANK", status: "REFUNDED" }, request);
  assert.deepEqual(refunded.ok ? null : refunded.status, 409);
  const issued = await saveCashReceiptRequest(fakeDb({ order_id: "o1", status: "ISSUED" }).db, { id: "o1", payment_method: "BANK", status: "PAID" }, request);
  assert.deepEqual(issued.ok ? null : issued.status, 409);
  const fresh = fakeDb(null);
  const created = await saveCashReceiptRequest(fresh.db, { id: "o1", payment_method: "BANK", status: "BANK_PENDING" }, request);
  assert.equal(created.ok && created.value?.identifierMasked, "010-****-5678");
  assert.deepEqual(fresh.calls, ["submission_order_cash_receipts:insert"]);
  const withdraw = fakeDb({ order_id: "o1", status: "REQUESTED" });
  assert.equal((await saveCashReceiptRequest(withdraw.db, { id: "o1", payment_method: "BANK", status: "BANK_PENDING" }, null)).ok, true);
  assert.deepEqual(withdraw.calls, ["submission_order_cash_receipts:delete"]);
});
