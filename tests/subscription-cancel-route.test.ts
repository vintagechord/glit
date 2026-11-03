import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";

import { GET as getUserCancel, POST as postUserCancel } from "../src/app/api/service/subscription/inicis_cancel/route";
import { POST as postPcCallback } from "../src/app/api/inicis/key-return/route";
import { POST as postMobileCallback } from "../src/app/api/inicis/mobile-return/route";
import { isSubscriptionBillingEnabled } from "../src/lib/payments/subscription-billing";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

function billingFlag(t: TestContext, value: string | undefined) {
  const previous = process.env.ONSIDE_SUBSCRIPTION_BILLING_ENABLED;
  if (value === undefined) delete process.env.ONSIDE_SUBSCRIPTION_BILLING_ENABLED;
  else process.env.ONSIDE_SUBSCRIPTION_BILLING_ENABLED = value;
  t.after(() => {
    if (previous === undefined) delete process.env.ONSIDE_SUBSCRIPTION_BILLING_ENABLED;
    else process.env.ONSIDE_SUBSCRIPTION_BILLING_ENABLED = previous;
  });
}

test("subscription cancellation rejects state-changing GET requests", async () => {
  const response = getUserCancel();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.deepEqual(await response.json(), { error: "Method Not Allowed" });
});

test("the administrator refund alias from the earlier site is gone", () => {
  assert.equal(existsSync(new URL("../src/app/api/wmadmin/b/membership/inicis_cancel/route.ts", import.meta.url)), false);
  const route = read("../src/app/api/service/subscription/inicis_cancel/route.ts");
  assert.doesNotMatch(route, /handleCancelRequest|requireAdmin|rpc\("is_admin"\)/);
  assert.match(route, /const adminAllowed = false;/);
});

test("subscription billing is off unless explicitly enabled; payment keys never switch it on", () => {
  assert.equal(isSubscriptionBillingEnabled({}), false);
  assert.equal(isSubscriptionBillingEnabled({ INICIS_BILLING_API_KEY_PROD: "key", INICIS_BILLING_API_IV_PROD: "iv", INICIS_LITE_KEY_PROD: "lite" }), false);
  for (const value of ["true", "yes", "0", " ", "2"]) assert.equal(isSubscriptionBillingEnabled({ ONSIDE_SUBSCRIPTION_BILLING_ENABLED: value }), false, value);
  assert.equal(isSubscriptionBillingEnabled({ ONSIDE_SUBSCRIPTION_BILLING_ENABLED: "1" }), true);
});

test("disabled subscription callbacks and refunds answer 410 before reading the request", async (t) => {
  billingFlag(t, undefined);
  const form = () => new NextRequest("https://iamonside.com/api/inicis/key-return", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ oid: "SUB-1", merchantData: "s".repeat(32), mid: "fixture" }),
  });
  for (const handler of [postPcCallback, postMobileCallback]) {
    const response = await handler(form());
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const refund = await postUserCancel(new NextRequest("https://iamonside.com/api/service/subscription/inicis_cancel", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: "SUB-1" }),
  }));
  assert.equal(refund.status, 410);
});

test("the subscription pages are hidden unless enabled and never indexed", () => {
  for (const path of ["../src/app/subscription/page.tsx", "../src/app/subscription/result/page.tsx"]) {
    const page = read(path);
    assert.match(page, /if \(!isSubscriptionBillingEnabled\(\)\) notFound\(\);/, path);
    assert.match(page, /robots: \{ index: false, follow: false \}/, path);
    assert.match(page, /export const dynamic = "force-dynamic";/, path);
    // The gate runs before any session read or billing attempt is created.
    assert.ok(page.indexOf("notFound();") < page.indexOf("createServerSupabase()"), path);
  }
});
