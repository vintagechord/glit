import assert from "node:assert/strict";
import test from "node:test";

import {
  canHandlePaymentApprovalCallback,
  getPaymentGroupSubmissionIds,
  hasPaymentGroupIntersection,
  isPaymentInProgressDatabaseError,
} from "../src/lib/payment-group";

test("getPaymentGroupSubmissionIds includes primary and grouped submissions", () => {
  assert.deepEqual(
    getPaymentGroupSubmissionIds({
      submission_id: "primary",
      raw_response: {
        paymentGroup: {
          submissionIds: ["primary", "secondary"],
          relatedSubmissionIds: ["legacy-related"],
        },
      },
    }),
    ["primary", "secondary", "legacy-related"],
  );
});

test("getPaymentGroupSubmissionIds tolerates malformed payment metadata", () => {
  assert.deepEqual(
    getPaymentGroupSubmissionIds({
      submission_id: " primary ",
      raw_response: { paymentGroup: { submissionIds: "not-an-array" } },
    }),
    ["primary"],
  );
  assert.deepEqual(getPaymentGroupSubmissionIds(null), []);
});

test("hasPaymentGroupIntersection detects primary and non-primary cart items", () => {
  const payments = [
    {
      submission_id: "primary",
      raw_response: {
        paymentGroup: { submissionIds: ["primary", "secondary"] },
      },
    },
  ];

  assert.equal(hasPaymentGroupIntersection(payments, ["primary"]), true);
  assert.equal(hasPaymentGroupIntersection(payments, ["secondary"]), true);
  assert.equal(hasPaymentGroupIntersection(payments, ["unrelated"]), false);
});

test("terminal payment callbacks cannot be approved late", () => {
  assert.equal(canHandlePaymentApprovalCallback("REQUESTED"), true);
  assert.equal(canHandlePaymentApprovalCallback("APPROVED"), true);
  assert.equal(canHandlePaymentApprovalCallback("FAILED"), false);
  assert.equal(canHandlePaymentApprovalCallback("CANCELED"), false);
  assert.equal(canHandlePaymentApprovalCallback(null), false);
});

test("requested-payment delete conflicts are recognized precisely", () => {
  assert.equal(
    isPaymentInProgressDatabaseError({
      code: "55000",
      message: "PAYMENT_IN_PROGRESS",
    }),
    true,
  );
  assert.equal(
    isPaymentInProgressDatabaseError({
      code: "55000",
      message: "PAYMENT_TERMINAL_STATE",
    }),
    false,
  );
  assert.equal(
    isPaymentInProgressDatabaseError({
      code: "23503",
      message: "PAYMENT_IN_PROGRESS",
    }),
    false,
  );
});
