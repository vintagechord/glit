import assert from "node:assert/strict";
import test from "node:test";

import {
  getPaymentGroupSubmissionIds,
  hasPaymentGroupIntersection,
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
