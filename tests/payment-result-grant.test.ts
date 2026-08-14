import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextResponse } from "next/server";

import {
  createPaymentResultGrant,
  PAYMENT_RESULT_GRANT_COOKIE,
  PAYMENT_RESULT_GRANT_TTL_SECONDS,
  readPaymentResultGrant,
  setPaymentResultGrantCookie,
} from "../src/lib/payment-result-grant";

const originalSecret = process.env.PAYMENT_RESULT_GRANT_SECRET;
process.env.PAYMENT_RESULT_GRANT_SECRET = "test-only-payment-result-secret-with-at-least-32-bytes";

test.after(() => {
  if (originalSecret === undefined) {
    delete process.env.PAYMENT_RESULT_GRANT_SECRET;
  } else {
    process.env.PAYMENT_RESULT_GRANT_SECRET = originalSecret;
  }
});

const submissionId = "11111111-1111-4111-8111-111111111111";
const nowMs = 2_000_000_000_000;

test("payment result grant is encrypted and bound to provider and submission", () => {
  const grant = createPaymentResultGrant({
    provider: "paypal",
    submissionId,
    orderId: "PAYPAL-ORDER-1",
    guestToken: "guest-secret-token-value",
    nowMs,
  });
  assert.ok(grant);
  assert.doesNotMatch(grant, /guest-secret-token-value|PAYPAL-ORDER-1/);
  assert.deepEqual(
    readPaymentResultGrant(grant, {
      submissionId,
      provider: "paypal",
      nowMs: nowMs + 1_000,
    }),
    {
      version: 1,
      purpose: "submission-payment-result",
      provider: "paypal",
      submissionId,
      orderId: "PAYPAL-ORDER-1",
      guestToken: "guest-secret-token-value",
      issuedAt: Math.floor(nowMs / 1_000),
      expiresAt:
        Math.floor(nowMs / 1_000) + PAYMENT_RESULT_GRANT_TTL_SECONDS,
    },
  );
  assert.equal(
    readPaymentResultGrant(grant, {
      submissionId: "22222222-2222-4222-8222-222222222222",
      nowMs,
    }),
    null,
  );
  assert.equal(
    readPaymentResultGrant(grant, {
      submissionId,
      provider: "inicis",
      nowMs,
    }),
    null,
  );
});

test("payment result grant rejects tampering and expiry", () => {
  const grant = createPaymentResultGrant({
    provider: "paypal",
    submissionId,
    orderId: "PAYPAL-ORDER-2",
    guestToken: "guest-secret-token-value",
    nowMs,
  });
  assert.ok(grant);
  const tampered = `${grant.slice(0, -1)}${grant.endsWith("A") ? "B" : "A"}`;
  assert.equal(readPaymentResultGrant(tampered, { submissionId, nowMs }), null);
  assert.equal(
    readPaymentResultGrant(grant, {
      submissionId,
      nowMs: nowMs + PAYMENT_RESULT_GRANT_TTL_SECONDS * 1_000,
    }),
    null,
  );
});

test("payment result cookie is short-lived, HttpOnly, Secure, and SameSite=Lax", () => {
  const response = NextResponse.redirect("https://onside.example/result");
  setPaymentResultGrantCookie(response, "encrypted-grant", { secure: true });
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`^${PAYMENT_RESULT_GRANT_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=lax/i);
  assert.match(setCookie, new RegExp(`Max-Age=${PAYMENT_RESULT_GRANT_TTL_SECONDS}`));
  assert.match(setCookie, /Path=\//i);
});

test("PayPal callback and guest detail use the server-only result grant", () => {
  const captureRoute = readFileSync(
    new URL("../src/app/api/paypal/capture/route.ts", import.meta.url),
    "utf8",
  );
  const detailPage = readFileSync(
    new URL(
      "../src/app/dashboard/submissions/[id]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");

  assert.doesNotMatch(captureRoute, /searchParams\.set\("guestToken"/);
  assert.match(captureRoute, /resolvePayPalReturnGuestAccess/);
  assert.match(captureRoute, /setPaymentResultGrantCookie/);
  assert.match(
    detailPage,
    /readPaymentResultGrant[\s\S]*\.is\("user_id", null\)[\s\S]*\.eq\("guest_token", paymentResultGrant\.guestToken\)/,
  );
  assert.match(
    detailPage,
    /ensureAlbumStationReviews\(\s*admin,/,
  );
  assert.match(
    proxy,
    /isSubmissionDetailRoute && hasPaymentResultGrant/,
  );
});
