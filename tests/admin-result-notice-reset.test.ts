import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resultNoticeResetOnStatusChange } from "../src/lib/admin/result-notice-reset";

// The result RPCs clear result_notified_at when a result changes, but the
// admin stage select did not. An album reopened for a re-review and set back
// to 결과 준비 showed 결과 통보 완료 at once, without a new mail, and the desk's
// 7-day retention counted from the old notice.

test("entering 결과 준비 or 완료 from an earlier stage voids the previous notice", () => {
  for (const previous of ["IN_PROGRESS", "SUBMITTED", "WAITING_PAYMENT", "DRAFT"]) {
    for (const next of ["RESULT_READY", "COMPLETED"]) {
      assert.deepEqual(resultNoticeResetOnStatusChange(previous, next), { result_notified_at: null }, `${previous} -> ${next}`);
    }
  }
});

test("moves within the result stages, or away from them, keep the notice", () => {
  assert.deepEqual(resultNoticeResetOnStatusChange("RESULT_READY", "COMPLETED"), {});
  assert.deepEqual(resultNoticeResetOnStatusChange("COMPLETED", "RESULT_READY"), {});
  assert.deepEqual(resultNoticeResetOnStatusChange("RESULT_READY", "RESULT_READY"), {});
  assert.deepEqual(resultNoticeResetOnStatusChange("RESULT_READY", "IN_PROGRESS"), {});
  assert.deepEqual(resultNoticeResetOnStatusChange("IN_PROGRESS", "IN_PROGRESS"), {});
});

test("both admin status writes apply the reset", () => {
  const source = readFileSync(new URL("../src/features/admin/actions.ts", import.meta.url), "utf8");
  assert.match(source, /submissionUpdate\.status = nextStatus;\s*Object\.assign\(submissionUpdate, resultNoticeResetOnStatusChange\(currentStatus, nextStatus\)\);/);
  assert.match(source, /\.update\(\{ status: parsed\.data\.status, \.\.\.resultNoticeResetOnStatusChange\(previous\.status, parsed\.data\.status\) \}\)/);
});
