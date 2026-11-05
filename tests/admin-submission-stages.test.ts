import assert from "node:assert/strict";
import test from "node:test";

import {
  adminSubmissionStageKeys,
  adminSubmissionStageOf,
  applyAdminSubmissionStageFilter,
  type AdminStageRow,
  type StageFilterable,
} from "../src/lib/admin/submission-stages";

type Row = Required<{ [K in keyof AdminStageRow]: string | null }>;
type Predicate = (row: Row) => boolean;

/** Evaluates the PostgREST filters the stage helper emits against plain rows. */
class FakeQuery implements StageFilterable<FakeQuery> {
  predicates: Predicate[] = [];
  private add(predicate: Predicate) { this.predicates.push(predicate); return this; }
  eq(column: string, value: string) { return this.add((row) => row[column as keyof Row] === value); }
  in(column: string, values: readonly string[]) { return this.add((row) => values.includes(row[column as keyof Row] ?? "")); }
  is(column: string, value: null) { return this.add((row) => row[column as keyof Row] === value); }
  not(column: string, operator: string, value: string | null) {
    if (operator === "is") return this.add((row) => row[column as keyof Row] !== null);
    const list = String(value).replace(/[()]/g, "").split(",");
    // SQL NOT IN is unknown for NULL, so the row is excluded.
    return this.add((row) => row[column as keyof Row] !== null && !list.includes(row[column as keyof Row] as string));
  }
  or(filters: string) {
    const parts = filters.split(",").map((part) => {
      const [column, ...rest] = part.split(".");
      const op = rest.join(".");
      return (row: Row) => {
        const value = row[column as keyof Row];
        if (op === "is.null") return value === null;
        if (op === "not.is.null") return value !== null;
        if (op.startsWith("eq.")) return value === op.slice(3);
        if (op.startsWith("neq.")) return value !== null && value !== op.slice(4);
        throw new Error(`unsupported ${part}`);
      };
    });
    return this.add((row) => parts.some((part) => part(row)));
  }
  matches(row: Row) { return this.predicates.every((predicate) => predicate(row)); }
}

const statuses = ["DRAFT", "SUBMITTED", "PRE_REVIEW", "WAITING_PAYMENT", "IN_PROGRESS", "RESULT_READY", "COMPLETED"];
const payments = ["UNPAID", "PAYMENT_PENDING", "PAID", "REFUNDED", null];

const allRows: Row[] = statuses.flatMap((status) => payments.flatMap((payment_status) =>
  [null, "order-1"].flatMap((current_order_id) => [null, "2026-11-05T00:00:00Z"].map((result_notified_at) => ({
    status, payment_status, current_order_id, result_notified_at,
  })))));

test("every non-draft row matches exactly the stage filter of its own stage", () => {
  for (const row of allRows) {
    const stage = adminSubmissionStageOf(row);
    const matching = adminSubmissionStageKeys.filter((key) => applyAdminSubmissionStageFilter(new FakeQuery(), key).matches(row));
    if (stage === null) assert.deepEqual(matching, [], `draft row ${JSON.stringify(row)} must not match a stage`);
    else assert.deepEqual(matching, [stage], `row ${JSON.stringify(row)}`);
  }
});

test("an application left at the upload step is drafting, not a paid or bank order", () => {
  // Production case 2026-11-05: guest album saved at step 5, no order, no files.
  assert.equal(adminSubmissionStageOf({ status: "PRE_REVIEW", payment_status: "UNPAID", current_order_id: null }), "drafting");
  // Paid PRE_REVIEW is "paid, waiting for the review" (20261023212202).
  assert.equal(adminSubmissionStageOf({ status: "PRE_REVIEW", payment_status: "PAID", current_order_id: "o" }), "paid");
  assert.equal(adminSubmissionStageOf({ status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING", current_order_id: "o" }), "bank_pending");
  assert.equal(adminSubmissionStageOf({ status: "SUBMITTED", payment_status: "UNPAID", current_order_id: null }), "unpaid");
});

test("results without a sent notice stay visible until the mail is recorded", () => {
  assert.equal(adminSubmissionStageOf({ status: "RESULT_READY", payment_status: "PAID", result_notified_at: null }), "result_pending");
  assert.equal(adminSubmissionStageOf({ status: "RESULT_READY", payment_status: "PAID", result_notified_at: "2026-11-05" }), "notified");
  assert.equal(adminSubmissionStageOf({ status: "IN_PROGRESS", payment_status: "PAID", result_notified_at: "2026-11-05" }), "in_review");
});
