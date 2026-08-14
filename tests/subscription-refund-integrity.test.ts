import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sanitizeSubscriptionRefundResponse } from "../src/app/api/service/subscription/inicis_cancel/route";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const refundMigration = read(
  "../supabase/migrations/0077_subscription_refund_integrity.sql",
);
const readPolicyMigration = read(
  "../supabase/migrations/0079_restrict_subscription_sensitive_reads.sql",
);
const cancelRoute = read(
  "../src/app/api/service/subscription/inicis_cancel/route.ts",
);
const resultPage = read("../src/app/subscription/result/page.tsx");

test("subscription refund claims bind the stored TID and serialize gateway calls", () => {
  assert.match(refundMigration, /function public\.claim_subscription_refund/);
  assert.match(
    refundMigration,
    /history\.order_id = v_order_id[\s\S]*history\.pg_tid = v_pg_tid[\s\S]*for update/,
  );
  assert.match(
    refundMigration,
    /refund_claim_token is not null[\s\S]*SUBSCRIPTION_REFUND_IN_PROGRESS/,
  );
  assert.match(
    cancelRoute,
    /requestRefund\(\{[\s\S]*tid: claim\.claimed_pg_tid/,
  );
  assert.doesNotMatch(cancelRoute, /const targetTid\s*=\s*payload\.tid/);
});

test("subscription cancellation hides ownership oracles and enforces streamed body limits", () => {
  assert.match(
    cancelRoute,
    /error\.code === "P0002"[\s\S]*error\.code === "42501"[\s\S]*status: 404/,
  );
  assert.match(
    cancelRoute,
    /totalBytes > MAX_CANCEL_BODY_BYTES[\s\S]*reader\.cancel/,
  );
});

test("failed refunds release the claim without changing APPROVED status", () => {
  const failureFunction = refundMigration.match(
    /create or replace function public\.fail_subscription_refund[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(failureFunction);
  assert.match(failureFunction, /v_history\.status <> 'APPROVED'/);
  assert.match(failureFunction, /refund_claim_token = null/);
  assert.match(
    failureFunction,
    /return query select 'APPROVED'::public\.subscription_charge_status/,
  );
  assert.doesNotMatch(failureFunction, /set status = 'FAILED'/);
});

test("successful refund finalization is one database transaction for all linked rows", () => {
  const finalizeFunction = refundMigration.match(
    /create or replace function public\.finalize_subscription_refund[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(finalizeFunction);
  assert.match(finalizeFunction, /update public\.subscription_history/);
  assert.match(finalizeFunction, /update public\.subscriptions/);
  assert.match(finalizeFunction, /update public\.subscription_billing/);
  assert.match(
    finalizeFunction,
    /SUBSCRIPTION_REFUND_SUBSCRIPTION_MISMATCH/,
  );
  assert.match(finalizeFunction, /SUBSCRIPTION_REFUND_BILLING_MISMATCH/);
  assert.match(
    refundMigration,
    /grant execute on function public\.finalize_subscription_refund[\s\S]*to service_role/,
  );
  assert.match(
    refundMigration,
    /revoke all on function public\.claim_subscription_refund[\s\S]*from public, anon, authenticated/,
  );
});

test("refund audit storage strips gateway credentials and card data", () => {
  const sanitized = sanitizeSubscriptionRefundResponse({
    resultCode: "00",
    resultMsg: "정상 취소",
    cancelDate: "20260815",
    cancelTime: "120000",
    authToken: "secret-auth-token",
    billKey: "secret-billing-key",
    cardNumber: "4111111111111111",
    signature: "secret-signature",
    refundUrl: "https://example.test/private?token=secret",
  });

  assert.deepEqual(sanitized, {
    provider: "inicis",
    resultCode: "00",
    resultMessage: "정상 취소",
    cancelDate: "20260815",
    cancelTime: "120000",
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /secret|411111|authToken|billKey/i);
});

test("sensitive subscription rows become admin-only after the app-safe projection ships", () => {
  assert.match(
    readPolicyMigration,
    /drop policy if exists "Subscription billing readable by owner or admin"/,
  );
  assert.match(
    readPolicyMigration,
    /drop policy if exists "Subscription history readable by owner or admin"/,
  );
  assert.match(
    readPolicyMigration,
    /create policy "Subscription billing readable by admin"[\s\S]*using \(public\.is_admin\(\)\)/,
  );
  assert.match(
    readPolicyMigration,
    /create policy "Subscription history readable by admin"[\s\S]*using \(public\.is_admin\(\)\)/,
  );

  assert.match(resultPage, /createAdminClient\(\)/);
  assert.match(resultPage, /\.eq\("user_id", userId as string\)/);
  assert.match(
    resultPage,
    /order_id, status, amount_krw, product_name, result_code, result_message, requested_at, paid_at, refunded_at/,
  );
  assert.doesNotMatch(resultPage, /\.select\("\*"\)/);
  assert.doesNotMatch(resultPage, /bill_key|raw_response|callback_state_hash/);
});
