import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { listSubmissionOrders, returnSubmissionOrderToCart } from "../src/lib/submission-orders";
import { canEditSubmission } from "../src/lib/submission-edit-access";
import { getSubmissionUploadBlockReason } from "../src/lib/submission-upload-access";

type Row = Record<string, unknown>;
const orderId = "10000000-0000-4000-8000-000000000001";
const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const owner = "30000000-0000-4000-8000-000000000001";
const token = "order-private-first-token";
const token2 = "order-private-second-token";
const actor = { userId: owner, guestTokensBySubmissionId: {} };
const guest = { userId: null, guestTokensBySubmissionId: { [first]: token } };
const item = (id = first, credential = token) => ({
  id, submission_id: id, submission_ref: id, type: "ALBUM", title: "Order snapshot",
  artist_name: "Artist", package_name: "Package", amount_krw: 49000, amount: 49000,
  is_oneclick: true, guest_token_hash: createHash("sha256").update(credential).digest("hex"),
});
const order = (extra: Row = {}) => ({
  id: orderId, user_id: owner, payment_method: "BANK", status: "BANK_PENDING",
  amount_krw: 49000, amount: 49000, currency: "KRW", source: "live", note: null,
  created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", paid_at: null, returned_at: null,
  items: [item()], payments: null, ...extra,
});
const parent = (extra: Row = {}) => ({
  id: first, user_id: owner, guest_token: null, current_order_id: orderId, status: "WAITING_PAYMENT",
  payment_status: "PAYMENT_PENDING", result_status: null, result_notified_at: null, user_deleted_at: null,
  reviews: [{ status: "NOT_SENT" }], ...extra,
});

function fixture(orders: Row[] = [order()], parents: Row[] = [parent()]) {
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];
  const state = { failTable: "", rpcError: null as { code: string } | null, returnedIds: [first] };
  const db = {
    from(table: string) {
      let rows = table === "submission_orders" ? orders : parents;
      let single = false;
      const q = {
        select(value: string) { calls.push({ table, method: "select", args: [value] }); return q; },
        eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return q; },
        is(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return q; },
        in(key: string, values: string[]) {
          calls.push({ table, method: "in", args: [key, values] });
          rows = key === "matching_items.submission_ref"
            ? rows.filter(row => (row.items as Row[]).some(item => values.includes(String(item.submission_ref))))
            : rows.filter(row => values.includes(String(row[key])));
          return q;
        },
        order() { return q; },
        range(start: number, end: number) { rows = rows.slice(start, end + 1); return q; },
        maybeSingle() { single = true; return q; },
        then(resolve: (result: unknown) => unknown) {
          return Promise.resolve({ data: state.failTable === table ? null : single ? rows[0] ?? null : rows,
            error: state.failTable === table ? { code: "DB_ERROR" } : null }).then(resolve);
        },
      };
      return q;
    },
    async rpc(name: string, args: unknown) {
      calls.push({ method: name, args: [args] });
      return { data: state.returnedIds.map(submission_id => ({ submission_id })), error: state.rpcError };
    },
  } as unknown as Parameters<typeof listSubmissionOrders>[0];
  return { db, state, calls };
}

test("member order reads are owner-scoped and never expose guest tokens or token hashes", async () => {
  const f = fixture([order(), order({ id: "other-order", user_id: "another-member" })]);
  const page = await listSubmissionOrders(f.db, actor);
  assert.equal(page.orders.length, 1);
  assert.equal(page.orders[0].canReturnToCart, true);
  assert.equal(page.orders[0].items[0].title, "Order snapshot");
  assert.equal(JSON.stringify(page).includes(token), false);
  assert.equal(JSON.stringify(page).includes("guest_token_hash"), false);
});

test("every item of a guest order requires its exact ID-to-token pair", async () => {
  const f = fixture([order({ user_id: null, items: [item(), item(second, token2)] })],
    [parent({ user_id: null, guest_token: token }), parent({ id: second, user_id: null, guest_token: token2 })]);
  assert.equal((await listSubmissionOrders(f.db, guest)).orders.length, 0);
  assert.equal((await listSubmissionOrders(f.db, { userId: null, guestTokensBySubmissionId: { [first]: token2, [second]: token } })).orders.length, 0);
  const page = await listSubmissionOrders(f.db, { userId: null, guestTokensBySubmissionId: { [first]: token, [second]: token2 } });
  assert.equal(page.orders.length, 1);
  assert.equal(page.orders[0].canReturnToCart, true);
});

test("canceled guest history survives a deleted cart item using its token hash, never an order UUID alone", async () => {
  const f = fixture([order({ user_id: null, status: "CANCELED", items: [{ ...item(), submission_id: null }] })], []);
  const page = await listSubmissionOrders(f.db, guest);
  assert.equal(page.orders.length, 1);
  assert.equal(page.orders[0].canReturnToCart, false);
  assert.equal((await listSubmissionOrders(f.db, { userId: null, guestTokensBySubmissionId: { [first]: "wrong-private-token" } })).orders.length, 0);
  assert.equal((await listSubmissionOrders(f.db, { userId: null, guestTokensBySubmissionId: {} })).orders.length, 0);
});

test("claiming a live guest submission revokes the old token's order access", async () => {
  const f = fixture([order({ user_id: null })], [parent({ user_id: owner, guest_token: null })]);
  assert.deepEqual(await listSubmissionOrders(f.db, guest), { orders: [], nextOffset: null });
});

test("order return availability follows authoritative financial, review and current-order state", async () => {
  for (const status of ["PAID", "REFUNDED", "REVIEW_REQUIRED"]) {
    const f = fixture([order({ status })]);
    assert.equal((await listSubmissionOrders(f.db, actor)).orders[0].canReturnToCart, false, status);
  }
  for (const changes of [
    { returned_at: "2026-09-08T01:00:00Z" },
    { payments: { status: "APPROVED", result_code: "0000" } },
    { payments: { status: "REQUESTED", result_code: "CAPTURE_IN_PROGRESS" } },
    { payments: [{ status: "REQUESTED", result_code: "APPROVAL_IN_PROGRESS" }] },
    { payments: [{ status: "REQUESTED", result_code: "APPROVAL_UNCERTAIN" }] },
  ]) {
    const f = fixture([order(changes)]);
    assert.equal((await listSubmissionOrders(f.db, actor)).orders[0].canReturnToCart, false);
  }
  for (const changes of [
    { current_order_id: "new-order" }, { payment_status: "PAID" }, { status: "IN_PROGRESS" },
    { result_status: "APPROVED" }, { user_deleted_at: "now" }, { reviews: [{ status: "SENT" }] },
  ]) {
    const f = fixture([order()], [parent(changes)]);
    assert.equal((await listSubmissionOrders(f.db, actor)).orders[0].canReturnToCart, false);
  }
});

test("a requested card order remains returnable before PG approval is claimed", async () => {
  const f = fixture([order({ payment_method: "CARD", status: "CARD_PENDING", payments: { status: "REQUESTED", result_code: null } })]);
  assert.equal((await listSubmissionOrders(f.db, actor)).orders[0].canReturnToCart, true);
});

test("order return checks ownership and state before RPC and validates the entire returned group", async () => {
  const f = fixture();
  assert.equal((await returnSubmissionOrderToCart(f.db, orderId, { ...actor, userId: "another-member" })).ok, false);
  assert.equal(f.calls.some(call => call.method === "return_submission_order_to_cart"), false);
  assert.deepEqual(await returnSubmissionOrderToCart(f.db, orderId, actor), { ok: true, submissionIds: [first] });
  const rpc = f.calls.find(call => call.method === "return_submission_order_to_cart")!;
  assert.deepEqual(rpc.args[0], { p_order_id: orderId, p_user_id: owner, p_guest_tokens_by_submission_id: {} });
  f.state.rpcError = { code: "55000" };
  assert.equal((await returnSubmissionOrderToCart(f.db, orderId, actor)).ok, false);
  f.state.rpcError = null; f.state.returnedIds = [second];
  assert.equal((await returnSubmissionOrderToCart(f.db, orderId, actor)).ok, false);
});

test("order history is paginated and database failures never become an empty success", async () => {
  const f = fixture(Array.from({ length: 31 }, (_, i) => order({ id: `order-${i}` })));
  const firstPage = await listSubmissionOrders(f.db, actor);
  assert.equal(firstPage.orders.length, 30); assert.equal(firstPage.nextOffset, 30);
  assert.equal((await listSubmissionOrders(f.db, actor, 30)).orders.length, 1);
  f.state.failTable = "submissions";
  await assert.rejects(listSubmissionOrders(f.db, actor), /주문 상태/);
});

test("failed orders stay immutable until explicitly returned to the cart", () => {
  const pendingOrder = { user_id: owner, guest_token: null, status: "SUBMITTED", payment_status: "UNPAID", current_order_id: orderId };
  assert.equal(canEditSubmission(pendingOrder, { userId: owner }), false);
  assert.equal(getSubmissionUploadBlockReason(pendingOrder), "NOT_EDITABLE");
  assert.equal(canEditSubmission({ ...pendingOrder, current_order_id: null }, { userId: owner }), true);
  assert.equal(getSubmissionUploadBlockReason({ ...pendingOrder, current_order_id: null }), null);
});
