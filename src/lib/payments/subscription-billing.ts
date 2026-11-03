import { NextResponse } from "next/server";

/**
 * Legacy subscription billing (card billing keys, monthly charges and member
 * self-refunds through INIAPI) is not part of the current service. Its page
 * and callbacks stay off unless ONSIDE_SUBSCRIPTION_BILLING_ENABLED=1 is set
 * explicitly; payment keys alone never switch it on.
 */
export const isSubscriptionBillingEnabled = (env: Record<string, string | undefined> = process.env) =>
  (env.ONSIDE_SUBSCRIPTION_BILLING_ENABLED ?? "").trim() === "1";

/** Response for every subscription billing route while the flag is off. */
export const subscriptionBillingGoneResponse = () =>
  NextResponse.json(
    { error: "정기결제는 제공하지 않는 서비스입니다." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
