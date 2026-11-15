import assert from "node:assert/strict";
import test from "node:test";

import {
  adminSubmissionStageBadge,
  adminSubmissionStageKeys,
  adminSubmissionStageOf,
  adminSubmissionStages,
  applyAdminSubmissionStageFilter,
  isPartialResultNotice,
  partialNoticeStage,
  type AdminStageRow,
  type StageFilterable,
} from "../src/lib/admin/submission-stages";

type Row = Required<{ [K in keyof AdminStageRow]: string | null }>;
type Predicate = (row: Row) => boolean;

/** Splits a PostgREST logic list on the commas outside parentheses. */
const splitTopLevel = (text: string) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") depth -= 1;
    else if (text[index] === "," && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  return [...parts, text.slice(start)];
};

/** One `column.op.value` term, or a nested `and(...)` / `or(...)` group. */
const condition = (part: string): Predicate => {
  const group = part.match(/^(and|or)\((.*)\)$/);
  if (group) {
    const inner = splitTopLevel(group[2]).map(condition);
    return (row) => (group[1] === "and" ? inner.every((item) => item(row)) : inner.some((item) => item(row)));
  }
  const [column, ...rest] = part.split(".");
  const op = rest.join(".");
  return (row) => {
    const value = row[column as keyof Row];
    if (op === "is.null") return value === null;
    if (op === "not.is.null") return value !== null;
    if (op.startsWith("eq.")) return value === op.slice(3);
    if (op.startsWith("neq.")) return value !== null && value !== op.slice(4);
    if (op.startsWith("in.(")) return value !== null && op.slice(4, -1).split(",").includes(value);
    throw new Error(`unsupported ${part}`);
  };
};

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
    const parts = splitTopLevel(filters).map(condition);
    return this.add((row) => parts.some((part) => part(row)));
  }
  matches(row: Row) { return this.predicates.every((predicate) => predicate(row)); }
}

const statuses = ["DRAFT", "SUBMITTED", "PRE_REVIEW", "WAITING_PAYMENT", "IN_PROGRESS", "RESULT_READY", "COMPLETED"];
const payments = ["UNPAID", "PAYMENT_PENDING", "PAID", "REFUNDED", null];

const allRows: Row[] = statuses.flatMap((status) => payments.flatMap((payment_status) =>
  [null, "order-1"].flatMap((current_order_id) => [null, "2026-11-05T00:00:00Z"].flatMap((result_notified_at) =>
    [null, "2026-11-16T00:00:00Z"].map((partial_result_notified_at) => ({
      status, payment_status, current_order_id, result_notified_at, partial_result_notified_at,
    }))))));

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

test("an album sent on while one station still has no result is notified, without being a finished review", () => {
  // TBS could not announce results (2026-11): the other stations are decided,
  // the operator moves the album on, and the application itself stays in review.
  const moved = { status: "IN_PROGRESS", payment_status: "PAID", partial_result_notified_at: "2026-11-16T03:00:00Z" };
  assert.equal(adminSubmissionStageOf(moved), "notified");
  assert.equal(isPartialResultNotice(moved), true);
  assert.deepEqual(adminSubmissionStageBadge(moved), { label: partialNoticeStage.label, tone: partialNoticeStage.tone });
  assert.notEqual(partialNoticeStage.label, adminSubmissionStages.notified.label);

  assert.equal(adminSubmissionStageOf({ ...moved, partial_result_notified_at: null }), "in_review");
});

test("once every station has a result the album waits for its result mail like any other", () => {
  const complete = { status: "RESULT_READY", payment_status: "PAID", result_notified_at: null, partial_result_notified_at: "2026-11-16T03:00:00Z" };
  assert.equal(adminSubmissionStageOf(complete), "result_pending");
  assert.equal(isPartialResultNotice(complete), false);

  const mailed = { ...complete, result_notified_at: "2026-12-01T00:00:00Z" };
  assert.equal(adminSubmissionStageOf(mailed), "notified");
  assert.equal(isPartialResultNotice(mailed), false);
  assert.deepEqual(adminSubmissionStageBadge(mailed), { label: adminSubmissionStages.notified.label, tone: adminSubmissionStages.notified.tone });
});

test("the mark means nothing outside a paid review in progress", () => {
  for (const row of allRows.filter((item) => item.partial_result_notified_at && !(item.status === "IN_PROGRESS" && item.payment_status === "PAID"))) {
    assert.equal(isPartialResultNotice(row), false, JSON.stringify(row));
    assert.equal(adminSubmissionStageOf(row), adminSubmissionStageOf({ ...row, partial_result_notified_at: null }), JSON.stringify(row));
  }
  assert.equal(adminSubmissionStageBadge({ status: "DRAFT", payment_status: "UNPAID" }), null);
});

test("the partial-notice filter lists exactly the albums waiting for a station", () => {
  for (const row of allRows) {
    const listed = applyAdminSubmissionStageFilter(new FakeQuery(), partialNoticeStage.key).matches(row);
    assert.equal(listed, isPartialResultNotice(row), JSON.stringify(row));
  }
});
