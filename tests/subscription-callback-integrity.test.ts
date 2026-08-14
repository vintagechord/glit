import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  maskSubscriptionCardNumber,
  scrubSubscriptionGatewayPayload,
  validateSubscriptionBillKeyBinding,
  validateSubscriptionBillingCharge,
} from "../src/lib/subscriptions/payment-callback";
import { GET as getPcCallback } from "../src/app/api/inicis/key-return/route";
import { GET as getMobileCallback } from "../src/app/api/inicis/mobile-return/route";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const migration = read(
  "../supabase/migrations/0078_subscription_callback_integrity.sql",
);
const mobileRoute = read(
  "../src/app/api/inicis/mobile-return/route.ts",
);
const pcRoute = read("../src/app/api/inicis/key-return/route.ts");
const stdPay = read("../src/lib/inicis/stdpay.ts");

test("subscription gateway audit scrubber recursively removes mixed-case secrets", () => {
  const safe = scrubSubscriptionGatewayPayload({
    resultCode: "00",
    nested: {
      P_CARD_NUM: "4111111111111111",
      P_BILL_KEY: "billing-secret",
      AUTH_TOKEN: "auth-secret",
      AUTH_SIGNATURE: "auth-signature-secret",
      authUrl: "https://gateway.example/private-token",
      netCancelUrl: "https://gateway.example/net-cancel-token",
      merchantreserved: "callback-secret",
      merchantData: "callback-secret-2",
      buyerEmail: "private@example.com",
      P_UNAME: "Private Buyer",
      P_MOBILE: "01012345678",
      P_EMAIL: "private-mobile@example.com",
    },
    array: [{ Sign_Key: "sign-secret" }, { orderid: "SUB-123" }],
  });

  assert.deepEqual(safe, {
    resultCode: "00",
    nested: {
      P_CARD_NUM: "[REDACTED]",
      P_BILL_KEY: "[REDACTED]",
      AUTH_TOKEN: "[REDACTED]",
      AUTH_SIGNATURE: "[REDACTED]",
      authUrl: "[REDACTED]",
      netCancelUrl: "[REDACTED]",
      merchantreserved: "[REDACTED]",
      merchantData: "[REDACTED]",
      buyerEmail: "[REDACTED]",
      P_UNAME: "[REDACTED]",
      P_MOBILE: "[REDACTED]",
      P_EMAIL: "[REDACTED]",
    },
    array: [{ Sign_Key: "[REDACTED]" }, { orderid: "SUB-123" }],
  });
  assert.doesNotMatch(
    JSON.stringify(safe),
    /411111|billing-secret|auth-secret|private@|private-token|Private Buyer|0101234/,
  );
});

test("subscription card data is masked before database persistence", () => {
  assert.equal(maskSubscriptionCardNumber("4111-1111-1111-1111"), "411111******1111");
  assert.equal(maskSubscriptionCardNumber("123456"), "12**56");
  assert.equal(maskSubscriptionCardNumber("411111******1111"), "411111******1111");
  assert.equal(maskSubscriptionCardNumber(null), null);
});

test("bill-key issue response is bound to order, MID, amount, and issue TID", () => {
  const valid = {
    expectedOrderId: "SUB-123",
    expectedAmount: 39_000,
    expectedMid: "onside-mid",
    actualOrderId: "SUB-123",
    actualAmount: "39,000",
    actualMid: "onside-mid",
    issueTid: "issue-tid",
    requireAmount: true,
  } as const;

  assert.equal(validateSubscriptionBillKeyBinding(valid), null);
  assert.equal(
    validateSubscriptionBillKeyBinding({ ...valid, actualOrderId: "SUB-other" }),
    "ORDER_ID_MISMATCH",
  );
  assert.equal(
    validateSubscriptionBillKeyBinding({ ...valid, actualMid: "other-mid" }),
    "MID_MISMATCH",
  );
  assert.equal(
    validateSubscriptionBillKeyBinding({ ...valid, actualAmount: "39001" }),
    "AMOUNT_MISMATCH",
  );
  assert.equal(
    validateSubscriptionBillKeyBinding({ ...valid, issueTid: "" }),
    "BILLKEY_TID_MISSING",
  );
});

test("billing approval requires exact amount and TID and validates optional order/MID", () => {
  const expected = {
    expectedOrderId: "SUB-123",
    expectedAmount: 39_000,
    expectedMid: "onside-mid",
  };
  assert.deepEqual(
    validateSubscriptionBillingCharge({
      ...expected,
      response: { resultCode: "00", tid: "billing-tid", price: "39000" },
    }),
    { error: null, tid: "billing-tid" },
  );
  assert.equal(
    validateSubscriptionBillingCharge({
      ...expected,
      response: { tid: "billing-tid", price: "39001" },
    }).error,
    "BILLING_AMOUNT_MISMATCH",
  );
  assert.equal(
    validateSubscriptionBillingCharge({
      ...expected,
      response: { tid: "billing-tid", price: "39000", moid: "SUB-other" },
    }).error,
    "BILLING_ORDER_ID_MISMATCH",
  );
  assert.equal(
    validateSubscriptionBillingCharge({
      ...expected,
      response: { tid: "billing-tid", price: "39000", mid: "other-mid" },
    }).error,
    "BILLING_MID_MISMATCH",
  );
  assert.equal(
    validateSubscriptionBillingCharge({
      ...expected,
      response: { price: "39000" },
    }).error,
    "BILLING_TID_MISSING",
  );
});

test("callback migration serializes claims and atomically finalizes subscription state", () => {
  assert.match(migration, /callback_state_hash text/);
  assert.match(migration, /from public\.subscription_history history[\s\S]*for update/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /callback_phase = 'PROCESSING'/);
  assert.match(migration, /v_history\.amount_krw is distinct from p_amount_krw/);
  assert.match(migration, /update public\.subscription_billing billing/);
  assert.match(migration, /update public\.subscriptions subscription/);
  assert.match(migration, /update public\.subscription_history history/);
  assert.match(
    migration,
    /revoke all on function public\.claim_subscription_billing_callback[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.finalize_subscription_billing_callback[\s\S]*to service_role/,
  );
});

test("database scrubber normalizes key case before matching and definitive failure removes unused keys", () => {
  assert.match(
    migration,
    /regexp_replace\(lower\(entry\.key\), '\[\^a-z0-9\]', '', 'g'\)/,
  );
  assert.match(migration, /authsignature\|signature\|hashdata/);
  assert.match(migration, /\^p\(uname\|mobile\|email\)\$/);
  assert.match(migration, /merchantreserved\|merchantdata\|callbackstate/);
  assert.match(
    migration,
    /delete from public\.subscription_billing billing[\s\S]*billing\.status = 'INACTIVE'/,
  );
});

test("mobile and PC requests carry order-bound state and reject mutating GET", () => {
  assert.match(stdPay, /period: params\.period \?\? "M2"/);
  assert.match(stdPay, /merchantreserved: params\.callbackState/);
  assert.match(stdPay, /acceptmethod: "BILLAUTH\(Card\):centerCd\(Y\)"/);
  assert.match(
    stdPay,
    /const merchantData = billing\?\.callbackState \?\? params\.merchantData\?\.trim\(\)/,
  );
  assert.match(stdPay, /\.\.\.\(merchantData \? \{ merchantData \} : \{\}\)/);
  assert.doesNotMatch(stdPay, /flg_crypto/);

  for (const route of [mobileRoute, pcRoute]) {
    assert.match(route, /claimSubscriptionBillingCallback\(/);
    assert.match(route, /export function GET\(\)[\s\S]*status: 405/);
    assert.doesNotMatch(route, /updateHistory\(/);
    assert.doesNotMatch(route, /storeBillingKey\(/);
  }
  assert.match(mobileRoute, /callbackState = formExactString\([\s\S]*"merchantreserved"/);
  assert.match(pcRoute, /callbackState = formExactString\([\s\S]*"merchantData"/);
});

test("subscription callback GET handlers return 405 without mutating state", async () => {
  for (const handler of [getPcCallback, getMobileCallback]) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.deepEqual(await response.json(), { error: "Method not allowed." });
  }
});
