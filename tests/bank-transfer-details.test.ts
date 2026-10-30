import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  formatDepositDue,
  getBankDepositDateRange,
  isDepositOverdue,
  isValidDepositorName,
  normalizeDepositorName,
  parseDepositDueAt,
  toKstDateString,
} from "../src/lib/bank-transfer-details";

// 2026-10-31 23:30 UTC is already 2026-11-01 08:30 in Korea.
const now = new Date("2026-10-31T23:30:00Z");

test("deposit dates are Korean calendar days from today to two weeks ahead", () => {
  assert.equal(toKstDateString(now), "2026-11-01");
  assert.deepEqual(getBankDepositDateRange(now), { min: "2026-11-01", max: "2026-11-15", suggested: "2026-11-04" });
  assert.equal(addDays("2026-02-27", 3), "2026-03-02");
});

test("the due moment is the end of the chosen day in Korea and must be inside the range", () => {
  assert.equal(parseDepositDueAt("2026-11-03", now)?.toISOString(), "2026-11-03T14:59:59.000Z");
  assert.equal(parseDepositDueAt("2026-11-01", now)?.toISOString(), "2026-11-01T14:59:59.000Z");
  assert.equal(parseDepositDueAt("2026-10-31", now), null);
  assert.equal(parseDepositDueAt("2026-11-16", now), null);
  assert.equal(parseDepositDueAt("2026-13-01", now), null);
  assert.equal(parseDepositDueAt("2026/11/03", now), null);
});

test("depositor names are trimmed, bounded and free of markup", () => {
  assert.equal(normalizeDepositorName("  홍 길동\u0000 "), "홍 길동");
  assert.equal(isValidDepositorName("홍길동"), true);
  assert.equal(isValidDepositorName(""), false);
  assert.equal(isValidDepositorName("a".repeat(41)), false);
  assert.equal(isValidDepositorName("<b>x</b>"), false);
});

test("due dates render as Korean dates and report overdue state", () => {
  assert.equal(formatDepositDue("2026-11-03T14:59:59.000Z"), "2026-11-03");
  assert.equal(formatDepositDue(null), null);
  assert.equal(isDepositOverdue("2026-11-03T14:59:59.000Z", new Date("2026-11-03T14:00:00Z")), false);
  assert.equal(isDepositOverdue("2026-11-03T14:59:59.000Z", new Date("2026-11-03T15:00:00Z")), true);
});
