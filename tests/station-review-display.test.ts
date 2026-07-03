import assert from "node:assert/strict";
import test from "node:test";

import { getStationReviewDisplayStatus } from "../src/lib/station-review-display";

test("station display status maps waiting submission and waiting result", () => {
  assert.equal(
    getStationReviewDisplayStatus({ status: "NOT_SENT" }).label,
    "접수대기",
  );
  assert.equal(
    getStationReviewDisplayStatus({ status: "SENT" }).label,
    "결과대기",
  );
  assert.equal(
    getStationReviewDisplayStatus({ status: "RECEIVED" }).label,
    "결과대기",
  );
});

test("station display status prioritizes action-needed and final results", () => {
  assert.equal(
    getStationReviewDisplayStatus({
      status: "NEEDS_FIX",
      track_results: [{ status: "APPROVED" }],
    }).label,
    "보완요청",
  );
  assert.equal(
    getStationReviewDisplayStatus({
      status: "SENT",
      track_results: [{ status: "REJECTED" }],
    }).label,
    "부적격",
  );
  assert.equal(
    getStationReviewDisplayStatus({
      status: "SENT",
      track_results: [{ status: "APPROVED" }],
    }).label,
    "적격",
  );
});

test("station display status exposes partial result and summary", () => {
  const status = getStationReviewDisplayStatus(
    {
      status: "SENT",
      track_results: [
        { status: "APPROVED" },
        { status: "REJECTED" },
        { status: "PENDING" },
      ],
    },
    { showPartialTrackBreakdown: true },
  );

  assert.equal(status.label, "부분 적격");
  assert.equal(status.needsAttention, true);
  assert.equal(status.summaryText, "1곡 적격 / 1곡 부적격 / 1곡 대기");
});
