import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasPayPalSubmissionAccess,
  summarizePayPalCaptureAudit,
  summarizePayPalGatewayError,
  summarizePayPalOrderAudit,
  summarizeUnexpectedPayPalError,
  validatePayPalCapture,
} from "../src/lib/payments/paypal";

const paypalSource = readFileSync(
  new URL("../src/lib/payments/paypal.ts", import.meta.url),
  "utf8",
);

test("PayPal submission access requires the member owner or exact guest token", () => {
  assert.equal(
    hasPayPalSubmissionAccess({
      submissionUserId: "member-a",
      actorUserId: "member-a",
    }),
    true,
  );
  assert.equal(
    hasPayPalSubmissionAccess({
      submissionUserId: "member-a",
      actorUserId: "member-b",
      guestToken: "guest-token-a",
    }),
    false,
  );
  assert.equal(
    hasPayPalSubmissionAccess({
      submissionGuestToken: "guest-token-a",
      guestToken: "guest-token-a",
    }),
    true,
  );
  assert.equal(
    hasPayPalSubmissionAccess({
      submissionGuestToken: "guest-token-a",
      guestToken: "guest-token-b",
    }),
    false,
  );
});

test("PayPal order creation constrains service-role reads by exact owner", () => {
  assert.match(
    paypalSource,
    /owner\?\.kind === "member"[\s\S]*?\.eq\("user_id", owner\.userId\)/,
  );
  assert.match(
    paypalSource,
    /owner\?\.kind === "guest"[\s\S]*?\.is\("user_id", null\)[\s\S]*?\.eq\("guest_token", owner\.guestToken\)/,
  );
  assert.match(
    paypalSource,
    /selectGlobalSubmission\(submissionId, \{[\s\S]*?kind: "member"[\s\S]*?userId: actorUserId/,
  );
  assert.match(
    paypalSource,
    /selectGlobalSubmission\(submissionId, \{[\s\S]*?kind: "guest"[\s\S]*?guestToken: normalizedGuestToken/,
  );
});

test("PayPal capture validation binds order, submission, amount, and currency", () => {
  const response = {
    id: "ORDER-1",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: "submission-1",
        payments: {
          captures: [
            {
              id: "CAPTURE-1",
              status: "COMPLETED",
              amount: { currency_code: "USD", value: "79.00" },
            },
          ],
        },
      },
    ],
  };

  assert.equal(
    validatePayPalCapture({
      response,
      orderId: "ORDER-1",
      submissionId: "submission-1",
      expectedAmount: 79,
      expectedCurrency: "usd",
    }),
    null,
  );
  assert.match(
    validatePayPalCapture({
      response,
      orderId: "ORDER-2",
      submissionId: "submission-1",
      expectedAmount: 79,
      expectedCurrency: "USD",
    }) ?? "",
    /order response/i,
  );
  assert.match(
    validatePayPalCapture({
      response,
      orderId: "ORDER-1",
      submissionId: "submission-2",
      expectedAmount: 79,
      expectedCurrency: "USD",
    }) ?? "",
    /submission/i,
  );
  assert.match(
    validatePayPalCapture({
      response,
      orderId: "ORDER-1",
      submissionId: "submission-1",
      expectedAmount: 80,
      expectedCurrency: "USD",
    }) ?? "",
    /amount or currency/i,
  );
  assert.match(
    validatePayPalCapture({
      response: {
        ...response,
        id: undefined,
      },
      orderId: "ORDER-1",
      submissionId: "submission-1",
      expectedAmount: 79,
      expectedCurrency: "USD",
    }) ?? "",
    /order response/i,
  );
  assert.match(
    validatePayPalCapture({
      response: {
        ...response,
        purchase_units: [
          {
            ...response.purchase_units[0],
            reference_id: undefined,
          },
        ],
      },
      orderId: "ORDER-1",
      submissionId: "submission-1",
      expectedAmount: 79,
      expectedCurrency: "USD",
    }) ?? "",
    /submission/i,
  );
  assert.match(
    validatePayPalCapture({
      response: {
        ...response,
        purchase_units: [
          {
            ...response.purchase_units[0],
            payments: {
              captures: [
                {
                  ...response.purchase_units[0].payments.captures[0],
                  status: "PENDING",
                },
              ],
            },
          },
        ],
      },
      orderId: "ORDER-1",
      submissionId: "submission-1",
      expectedAmount: 79,
      expectedCurrency: "USD",
    }) ?? "",
    /not complete/i,
  );
});

test("PayPal gateway error logs use an allowlist and omit payer data", () => {
  const summary = summarizePayPalGatewayError({
    httpStatus: 422,
    orderId: "PAYPAL-SECRET-ORDER-ID",
    payload: {
      name: "UNPROCESSABLE_ENTITY",
      message: "payer person@example.com failed",
      debug_id: "debug-1",
      status: "FAILED",
      payer: { email_address: "person@example.com" },
      details: [
        {
          issue: "AMOUNT_MISMATCH",
          description: "person@example.com and private address",
        },
      ],
    },
  });
  const serialized = JSON.stringify(summary);
  assert.deepEqual(summary.issues, ["AMOUNT_MISMATCH"]);
  assert.equal(summary.httpStatus, 422);
  assert.doesNotMatch(serialized, /person@example\.com|private address/);
  assert.doesNotMatch(serialized, /PAYPAL-SECRET-ORDER-ID/);

  const unexpected = summarizeUnexpectedPayPalError({
    name: "GatewayError",
    code: "ECONNRESET",
    message: "payer@example.com token=secret",
    response: { payer: { email_address: "payer@example.com" } },
  });
  assert.deepEqual(unexpected, {
    name: "GatewayError",
    code: "ECONNRESET",
  });
  assert.doesNotMatch(JSON.stringify(unexpected), /payer@example\.com|secret/);
});

test("PayPal database audit summaries omit approval URLs and payer data", () => {
  const orderAudit = summarizePayPalOrderAudit({
    id: "ORDER-SECRET",
    status: "CREATED",
    links: [
      {
        rel: "approve",
        method: "GET",
        href: "https://paypal.example/checkout?token=LONG-LIVED-TOKEN",
      },
    ],
    payer: { email_address: "payer@example.com" },
  });
  const captureAudit = summarizePayPalCaptureAudit({
    id: "ORDER-SECRET",
    status: "COMPLETED",
    payer: { email_address: "payer@example.com" },
    purchase_units: [
      {
        reference_id: "submission-secret",
        payments: {
          captures: [
            {
              id: "CAPTURE-1",
              status: "COMPLETED",
              amount: { currency_code: "USD", value: "79.00" },
              seller_protection: { dispute_categories: ["ITEM_NOT_RECEIVED"] },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(orderAudit, {
    provider: "paypal",
    kind: "order",
    id: "ORDER-SECRET",
    status: "CREATED",
    name: null,
    debugId: null,
    issues: [],
    linkRelations: ["approve"],
  });
  assert.deepEqual(captureAudit, {
    provider: "paypal",
    kind: "capture",
    id: "ORDER-SECRET",
    status: "COMPLETED",
    name: null,
    debugId: null,
    issues: [],
    captures: [
      {
        id: "CAPTURE-1",
        status: "COMPLETED",
        amount: { currencyCode: "USD", value: "79.00" },
      },
    ],
  });
  const serialized = JSON.stringify({ orderAudit, captureAudit });
  assert.doesNotMatch(
    serialized,
    /payer@example\.com|LONG-LIVED-TOKEN|paypal\.example|submission-secret|seller_protection/,
  );
});
