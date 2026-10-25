import assert from "node:assert/strict";
import test from "node:test";
import { paymentStatusLabelMap, reviewStatusLabelMap } from "../src/constants/review-status";
import { getPaidReviewProgress } from "../src/lib/paid-review-progress";

test("confirmed payments and the initial review stage have separate labels", () => {
  assert.equal(paymentStatusLabelMap.PAID, "결제 완료");
  assert.equal(reviewStatusLabelMap.PRE_REVIEW, "접수예정");
  assert.equal(reviewStatusLabelMap.SUBMITTED, "신청 완료");
});

test("paid album and broadcast MV remain pending until a broadcaster receives them", () => {
  for (const stationTotal of [1, 5, 10]) {
    for (const status of ["PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"]) {
      assert.equal(getPaidReviewProgress({ status, stationTotal }), "WAITING_SUBMISSION");
    }
  }
});

test("paid online MV is pending while no board progress or result exists", () => {
  assert.equal(getPaidReviewProgress({ status: "PRE_REVIEW" }), "WAITING_SUBMISSION");
  assert.equal(getPaidReviewProgress({ status: "IN_PROGRESS" }), "IN_PROGRESS");
  assert.equal(getPaidReviewProgress({ status: "RESULT_READY", resultDelivered: true }), "COMPLETED");
});

test("actual station progress takes precedence over an older preparation state", () => {
  assert.equal(getPaidReviewProgress({ status: "PRE_REVIEW", stationTotal: 5, stationSubmitted: 1 }), "IN_PROGRESS");
  assert.equal(getPaidReviewProgress({ status: "PRE_REVIEW", stationTotal: 5, stationCompleted: 2 }), "IN_PROGRESS");
  assert.equal(getPaidReviewProgress({ status: "PRE_REVIEW", stationTotal: 5, stationCompleted: 5 }), "COMPLETED");
});

test("progress is neither reset nor falsely completed when station outcomes are incomplete", () => {
  for (const status of ["IN_PROGRESS", "RESULT_READY", "COMPLETED"]) {
    assert.equal(getPaidReviewProgress({ status, stationTotal: 5, stationCompleted: 2 }), "IN_PROGRESS");
  }
  assert.equal(getPaidReviewProgress({ status: "PRE_REVIEW", stationTotal: 0, stationCompleted: 0 }), "WAITING_SUBMISSION");
});
