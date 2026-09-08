import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedTrackResult } from "../src/lib/music-archive/reviews";

test("archive reads the latest exact mapped track result without resetting persisted approval", () => {
  const row = { status: "SENT", track_results_json: [{ track_id: "a", status: "APPROVED" }, { track_id: "b", status: "REJECTED" }], updated_at: "2026-09-08" };
  assert.equal(linkedTrackResult(row, "a").result, "approved");
  assert.equal(linkedTrackResult(row, "b").result, "rejected");
  assert.equal(linkedTrackResult({ ...row, track_results_json: JSON.stringify(row.track_results_json) }, "a").result, "approved");
  assert.deepEqual(row.track_results_json[0], { track_id: "a", status: "APPROVED" });
});
test("completed submission or album result never approves an unmapped version", () => {
  assert.equal(linkedTrackResult({ status: "APPROVED", track_results_json: [{ track_id: "original", title: "Same", status: "APPROVED" }] }, "clean").result, "unknown");
  assert.equal(linkedTrackResult({ status: "COMPLETED" }, "a").result, "unknown");
});
