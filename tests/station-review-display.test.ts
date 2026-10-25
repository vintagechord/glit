import assert from "node:assert/strict";
import test from "node:test";

import { getStationReviewDisplayStatus } from "../src/lib/station-review-display";

test("station display status maps waiting submission and waiting result", () => {
  assert.equal(
    getStationReviewDisplayStatus({ status: "NOT_SENT" }).label,
    "접수예정",
  );
  assert.equal(
    getStationReviewDisplayStatus({ status: "SENT" }).label,
    "접수완료",
  );
  assert.equal(
    getStationReviewDisplayStatus({ status: "RECEIVED" }).label,
    "접수완료",
  );
});

test("station display status prioritizes action-needed and final results", () => {
  assert.equal(
    getStationReviewDisplayStatus({
      status: "NEEDS_FIX",
      track_results: [{ status: "APPROVED" }],
    }).label,
    "보완 요청",
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

test("station display status does not finish review while any track is pending", () => {
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

  assert.equal(status.label, "접수완료");
  assert.equal(status.isComplete, false);
  assert.equal(status.summaryText, "1곡 적격 / 1곡 부적격 / 1곡 대기");
});

test("missing station results and correction requests never count as completed", () => {
  for (const value of ["RESULT_READY", "COMPLETED", "NEEDS_FIX"]) {
    assert.equal(getStationReviewDisplayStatus({ status: value }).isComplete, false);
  }
});

test("an explicit station rejection cannot be overturned by older track approvals", () => {
  assert.equal(getStationReviewDisplayStatus({ status: "REJECTED", track_results: [{ status: "APPROVED" }] }).key, "REJECTED");
});

test("completed mixed outcomes remain partial even if the station was marked approved", () => {
  const status = getStationReviewDisplayStatus({
    status: "APPROVED",
    track_results: [{ status: "APPROVED" }, { status: "REJECTED" }],
  });
  assert.equal(status.key, "PARTIAL");
  assert.equal(status.isComplete, true);
});

test("omitted album tracks keep a station in review", () => {
  const status = getStationReviewDisplayStatus({
    status: "APPROVED", track_results: [{ track_id: "one", status: "APPROVED" }],
  }, { albumTracks: [{ id: "one" }, { id: "two" }] });
  assert.equal(status.isComplete, false);
  assert.equal(status.summary.counts.pending, 1);
});

test("unselected WBS tracks do not keep an otherwise completed review pending", () => {
  const tracks = [1, 2, 3, 4].map(track_no => ({ track_no, broadcast_selected: track_no <= 3 }));
  const review = { status: "APPROVED", station: { code: "WBS" }, track_results: [1, 2, 3].map(track_no => ({ track_no, status: "APPROVED" })) };
  assert.equal(getStationReviewDisplayStatus(review, { albumTracks: tracks }).isComplete, true);
  assert.equal(getStationReviewDisplayStatus({ ...review, station: { code: "KBS" } }, { albumTracks: tracks }).isComplete, false);
});

test("WBS unknown selection stays unresolved until three current track IDs have final results", () => {
  const tracks = [1, 2, 3, 4].map(track_no => ({ id: `track-${track_no}`, track_no }));
  const review = { status: "APPROVED", station: { code: "WBS" }, track_results: [] as unknown[] };
  const missing = getStationReviewDisplayStatus(review, { albumTracks: tracks });
  assert.equal(missing.isComplete, false);
  assert.equal(missing.label, "심의곡 확인 필요");
  assert.equal(getStationReviewDisplayStatus({ ...review, track_results: [1, 2, 4].map(no => ({ track_id: `track-${no}`, status: "APPROVED" })) }, { albumTracks: tracks }).isComplete, true);
});

test("broadcast ratings are station-specific final labels without changing album results", () => {
  assert.equal(getStationReviewDisplayStatus({ status: "APPROVED", age_rating: "12" }).label, "12세 이상 시청가");
  assert.equal(getStationReviewDisplayStatus({ status: "APPROVED", age_rating: "ALL" }).label, "전체 시청가");
  assert.equal(getStationReviewDisplayStatus({ status: "APPROVED", age_rating: null }).label, "적격");
  assert.equal(getStationReviewDisplayStatus({ status: "NEEDS_FIX", age_rating: "19" }).label, "보완 요청");
  assert.equal(getStationReviewDisplayStatus({ status: "REJECTED", age_rating: "19" }).label, "부적격");
});
