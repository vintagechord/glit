import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  cashReceiptAttention,
  isCashReceiptEditable,
  isCashReceiptPdfWithheld,
  isCashReceiptResultUnknown,
} from "../src/lib/cash-receipts";
import {
  issueCashReceiptViaInicis,
  resolveUncertainCashReceipt,
  saveCashReceiptRequest,
} from "../src/lib/cash-receipts-server";
import { getCashReceiptInicisConfig } from "../src/lib/inicis/cash-receipt";

type Row = Record<string, unknown>;
const ORDER = "3f1c2b8e-1d2a-4c6b-9a7e-5b2d1e0f9a11";
const ADMIN = "9f1c2b8e-1d2a-4c6b-9a7e-5b2d1e0f9a11";
const READ_AT = "2026-11-03T01:00:00.123456+00:00";
const paidOrder = { id: ORDER, user_id: null, payment_method: "BANK", status: "PAID", amount_krw: 55000, paid_at: READ_AT, created_at: READ_AT, depositor_name: "홍길동", items: [] };
const receipt = (extra: Row = {}): Row => ({
  order_id: ORDER, purpose: "INCOME_DEDUCTION", identifier: "01012345678", status: "REQUESTED", issue_method: null,
  approval_number: null, provider_tid: null, issued_at: null, amount_krw: null, supply_krw: null, vat_krw: null,
  failure_message: null, issued_by: null, canceled_at: null, cancel_reason: null, requested_at: READ_AT, updated_at: READ_AT, ...extra,
});

/** Conditional updates apply only when every filter matches the stored row,
 * like PostgREST over a single receipt row. */
function receiptDb(initial: Row, options: { afterRead?: (row: Row) => Row } = {}) {
  const state = { receipt: { ...initial }, order: { ...paidOrder } as Row, ops: [] as Array<{ op: string; filters: Row; fields: Row; applied: boolean }> };
  // Like supabase-js, each select/update/delete on a table handle starts a
  // fresh filter chain (the code reuses one handle for claim and result).
  const from = (table: string) => ({
    select: () => chainFor(table, "select", {}),
    update: (value: Row) => chainFor(table, "update", value),
    delete: () => chainFor(table, "delete", {}),
    insert: (value: Row) => chainFor(table, "insert", value),
  });
  const chainFor = (table: string, op: string, fields: Row) => {
    const filters: Row = {}; const inFilters: Record<string, unknown[]> = {};
    const resolve = () => {
      if (table === "submission_orders") return { data: state.order, error: null };
      if (table === "submissions") return { data: null, error: null };
      if (op === "select") {
        const snapshot = { ...state.receipt };
        if (options.afterRead) state.receipt = options.afterRead(state.receipt);
        return { data: [snapshot], error: null };
      }
      const applied = Object.entries(filters).every(([key, value]) => state.receipt[key] === value)
        && Object.entries(inFilters).every(([key, values]) => values.includes(state.receipt[key]));
      state.ops.push({ op, filters: { ...filters, ...inFilters }, fields, applied });
      if (!applied) return { data: null, error: null };
      if (op === "delete") return { data: null, error: null };
      state.receipt = { ...state.receipt, ...fields };
      return { data: { ...state.receipt }, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      in: (key: string, values: unknown[]) => { inFilters[key] = values; return chain; },
      maybeSingle: async () => resolve(),
      then: (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled),
    };
    return chain;
  };
  return { db: { from } as never, state };
}

function inicisEnv(t: TestContext) {
  const keys = ["INICIS_ENV", "INICIS_MID_STG", "INICIS_INIAPI_KEY_STG", "INICIS_INIAPI_IV_STG", "INICIS_API_URL_STG"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { INICIS_ENV: "stg", INICIS_MID_STG: "INIpayTest", INICIS_INIAPI_KEY_STG: "ItEQKi3rY7uvDS8l", INICIS_INIAPI_IV_STG: "HYb3yQ4f65QL89==" });
  delete process.env.INICIS_API_URL_STG;
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}

test("an issuance without a readable Inicis reply is UNCERTAIN, and customers can neither edit nor withdraw it", async (t) => {
  inicisEnv(t);
  let gatewayCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { gatewayCalls += 1; throw new Error("timeout"); });
  const { db, state } = receiptDb(receipt());
  const issued = await issueCashReceiptViaInicis(db, ORDER, ADMIN);
  assert.equal(issued.ok ? null : issued.status, 504);
  assert.equal(gatewayCalls, 1);
  assert.equal(state.receipt.status, "UNCERTAIN");
  assert.doesNotMatch(String(state.receipt.failure_message), /^\[결과 확인 필요\]/);
  assert.equal(isCashReceiptEditable("UNCERTAIN"), false);

  const order = { id: ORDER, payment_method: "BANK", status: "PAID" };
  const changed = await saveCashReceiptRequest(db, order, { purpose: "INCOME_DEDUCTION", identifier: "01099998888" });
  const withdrawn = await saveCashReceiptRequest(db, order, null);
  assert.deepEqual([changed.ok ? 200 : changed.status, withdrawn.ok ? 200 : withdrawn.status], [409, 409]);
  assert.equal(state.receipt.identifier, "01012345678");
  assert.equal(state.ops.some((entry) => entry.op === "delete"), false);

  // Nor can it be issued again before an administrator checks the console.
  assert.equal((await issueCashReceiptViaInicis(db, ORDER, ADMIN)).ok, false);
  assert.equal(gatewayCalls, 1);
});

test("a definite Inicis rejection stays FAILED and correctable", async (t) => {
  inicisEnv(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ resultCode: "ER0400", resultMsg: "해시 데이터가 일치하지 않습니다." }));
  const { db, state } = receiptDb(receipt());
  assert.equal((await issueCashReceiptViaInicis(db, ORDER, ADMIN)).ok, false);
  assert.equal(state.receipt.status, "FAILED");
  assert.equal(isCashReceiptEditable("FAILED"), true);
});

test("issuance claims the exact version it read, so a customer edit in between never sends the old number", async (t) => {
  inicisEnv(t);
  let gatewayCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { gatewayCalls += 1; return Response.json({ resultCode: "00", authNumber: "123456789" }); });
  const { db, state } = receiptDb(receipt(), {
    afterRead: (row) => ({ ...row, identifier: "01099998888", updated_at: "2026-11-03T01:00:01.000000+00:00" }),
  });
  const result = await issueCashReceiptViaInicis(db, ORDER, ADMIN);
  assert.equal(result.ok ? null : result.status, 409);
  assert.equal(gatewayCalls, 0);
  const claim = state.ops.find((entry) => entry.fields.status === "ISSUING");
  assert.deepEqual([claim?.filters.updated_at, claim?.filters.identifier, claim?.applied], [READ_AT, "01012345678", false]);
  assert.equal(state.receipt.status, "REQUESTED");
});

test("administrators settle an unknown result only for UNCERTAIN rows or ISSUING claims whose process died", async () => {
  const freshNow = Date.parse(READ_AT) + 60_000;
  const staleNow = Date.parse(READ_AT) + 6 * 60_000;
  assert.equal(isCashReceiptResultUnknown({ status: "ISSUING", updated_at: READ_AT }, freshNow), false);
  assert.equal(isCashReceiptResultUnknown({ status: "ISSUING", updated_at: READ_AT }, staleNow), true);

  const uncertain = receiptDb(receipt({ status: "UNCERTAIN", failure_message: "이니시스 응답을 받지 못했습니다." }));
  const issued = await resolveUncertainCashReceipt(uncertain.db, ORDER, ADMIN, { outcome: "ISSUED", approvalNumber: "269620648", issuedAt: "2026-11-03T10:00:00+09:00" }, staleNow);
  assert.equal(issued.ok, true);
  assert.deepEqual([uncertain.state.receipt.status, uncertain.state.receipt.issue_method, uncertain.state.receipt.approval_number, uncertain.state.receipt.amount_krw], ["ISSUED", "INICIS", "269620648", 55000]);

  const stale = receiptDb(receipt({ status: "ISSUING" }));
  assert.equal((await resolveUncertainCashReceipt(stale.db, ORDER, ADMIN, { outcome: "NOT_ISSUED", note: "발행 내역 없음" }, staleNow)).ok, true);
  assert.equal(stale.state.receipt.status, "FAILED");
  assert.match(String(stale.state.receipt.failure_message), /관리자 확인/);
  assert.equal(stale.state.ops.at(-1)?.filters.updated_at, READ_AT, "the resolution is conditional on the claim it inspected");

  for (const [row, now] of [[receipt({ status: "ISSUING" }), freshNow], [receipt(), staleNow], [receipt({ status: "ISSUED", approval_number: "1" }), staleNow]] as const) {
    const { db, state } = receiptDb(row);
    const result = await resolveUncertainCashReceipt(db, ORDER, ADMIN, { outcome: "NOT_ISSUED", note: "확인" }, now);
    assert.equal(result.ok ? null : result.status, 409, String(row.status));
    assert.equal(state.ops.length, 0);
  }
  assert.equal((await resolveUncertainCashReceipt(receiptDb(receipt({ status: "UNCERTAIN" })).db, ORDER, ADMIN, { outcome: "NOT_ISSUED", note: " " }, staleNow)).ok, false);
});

test("withdrawing a rejected request keeps its trace as a cancelled row", async () => {
  const { db, state } = receiptDb(receipt({ status: "FAILED", failure_message: "이니시스: 잘못된 번호" }));
  const result = await saveCashReceiptRequest(db, { id: ORDER, payment_method: "BANK", status: "PAID" }, null);
  assert.equal(result.ok, true);
  assert.deepEqual(state.ops.map((entry) => entry.op), ["update"]);
  assert.deepEqual([state.receipt.status, state.receipt.failure_message], ["CANCELED", "이니시스: 잘못된 번호"]);
});

test("refunded or cancelled orders surface their issued receipt for Hometax cancellation and withhold the PDF", () => {
  const now = Date.parse(READ_AT) + 60_000;
  const issued = { status: "ISSUED" as const, updated_at: READ_AT };
  assert.equal(cashReceiptAttention(issued, "REFUNDED", now), "CANCEL_IN_HOMETAX");
  assert.equal(cashReceiptAttention(issued, "CANCELED", now), "CANCEL_IN_HOMETAX");
  assert.equal(cashReceiptAttention(issued, "PAID", now), null);
  assert.equal(cashReceiptAttention({ status: "REQUESTED", updated_at: READ_AT }, "PAID", now), "ISSUE");
  assert.equal(cashReceiptAttention({ status: "REQUESTED", updated_at: READ_AT }, "BANK_PENDING", now), null);
  assert.equal(cashReceiptAttention({ status: "UNCERTAIN", updated_at: READ_AT }, "REFUNDED", now), "VERIFY");
  assert.equal(cashReceiptAttention({ status: "CANCELED", updated_at: READ_AT }, "REFUNDED", now), null);
  assert.equal(isCashReceiptPdfWithheld("REFUNDED", "ISSUED"), true);
  assert.equal(isCashReceiptPdfWithheld("PAID", "ISSUED"), false);
  assert.equal(isCashReceiptPdfWithheld("REFUNDED", "CANCELED"), false, "a recorded cancellation prints as cancelled");
});

test("the receipt API key never falls back to the subscription billing key", (t) => {
  const keys = ["INICIS_ENV", "INICIS_MID_PROD", "INICIS_INIAPI_KEY_PROD", "INICIS_INIAPI_IV_PROD"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.INICIS_ENV = "prod";
  delete process.env.INICIS_INIAPI_KEY_PROD; delete process.env.INICIS_INIAPI_IV_PROD;
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const billingOnly = { INICIS_MID_PROD: "MID", INICIS_BILLING_API_KEY_PROD: "ItEQKi3rY7uvDS8l", INICIS_BILLING_API_IV_PROD: "HYb3yQ4f65QL89==" };
  assert.equal(getCashReceiptInicisConfig(billingOnly), null);
  assert.deepEqual(getCashReceiptInicisConfig({ ...billingOnly, INICIS_INIAPI_KEY_PROD: "k".repeat(16), INICIS_INIAPI_IV_PROD: "v".repeat(16) }),
    { mid: "MID", apiKey: "k".repeat(16), apiIv: "v".repeat(16), apiUrl: "https://iniapi.inicis.com" });
});
