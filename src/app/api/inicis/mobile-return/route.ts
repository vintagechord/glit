import { NextRequest, NextResponse } from "next/server";

import { getBillingConfig } from "@/lib/inicis/config";
import { readBoundedInicisCallbackForm } from "@/lib/inicis/callback-request";
import {
  completeClaimedSubscriptionCharge,
  scrubSubscriptionGatewayPayload,
  validateSubscriptionBillKeyBinding,
} from "@/lib/subscriptions/payment-callback";
import {
  claimSubscriptionBillingCallback,
  failSubscriptionBillingCallback,
} from "@/lib/subscriptions/service";
import { getBaseUrl, getClientIp } from "../../../../lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redirectToResult = (
  baseUrl: string,
  orderId: string,
  status: "success" | "fail" | "pending",
  message?: string,
) => {
  // The result page resolves the owner-bound database row by order ID. Do not
  // persist gateway/status messages in browser history or proxy access logs.
  void status;
  void message;
  const url = new URL("/subscription/result", baseUrl);
  url.searchParams.set("orderId", orderId);
  return NextResponse.redirect(url, 303);
};

const formString = (form: FormData, ...keys: string[]) => {
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
};

const formExactString = (form: FormData, ...keys: string[]) => {
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value === "string" && value) return value;
  }
  return "";
};

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const formResult = await readBoundedInicisCallbackForm(req);
  if (!formResult.ok) {
    return NextResponse.json(
      { error: "Invalid mobile billing callback payload." },
      { status: formResult.reason === "too_large" ? 413 : 400 },
    );
  }
  const form = formResult.form;

  const orderId = formString(form, "orderid", "orderId", "P_OID");
  const callbackState = formExactString(
    form,
    "merchantreserved",
    "merchantReserved",
  );
  const mid = formString(form, "mid", "MID");
  const resultCode = formString(
    form,
    "resultcode",
    "resultCode",
    "P_STATUS",
  );
  const resultMessage = formString(
    form,
    "resultmsg",
    "resultMsg",
    "resultmessage",
    "P_RMESG1",
  );
  const callbackPayload = Object.fromEntries(form.entries());
  const safeCallback = scrubSubscriptionGatewayPayload({
    callback: callbackPayload,
  }) as Record<string, unknown>;

  if (!orderId || callbackState.length < 32 || !mid) {
    return NextResponse.json(
      { error: "Missing order, merchant state, or MID in mobile callback." },
      { status: 400 },
    );
  }

  let config: ReturnType<typeof getBillingConfig>;
  try {
    config = getBillingConfig();
  } catch (error) {
    console.error("[Inicis][subscription-mobile] billing config unavailable", {
      orderId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      "결제 설정을 확인할 수 없습니다.",
    );
  }

  if (mid !== config.mid) {
    return redirectToResult(baseUrl, orderId, "fail", "MID mismatch");
  }

  const claimed = await claimSubscriptionBillingCallback({
    orderId,
    callbackState,
    channel: "MOBILE",
  });
  if (claimed.error || !claimed.claim) {
    console.warn("[Inicis][subscription-mobile] callback claim rejected", {
      orderId,
      code: claimed.error?.code ?? null,
      message: claimed.error?.message ?? null,
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      "유효하지 않거나 종료된 결제 요청입니다.",
    );
  }
  if (claimed.claim.already_approved) {
    return redirectToResult(baseUrl, orderId, "success");
  }
  if (claimed.claim.already_processing) {
    return redirectToResult(
      baseUrl,
      orderId,
      "pending",
      "이미 처리 중인 결제입니다.",
    );
  }

  const claimToken = claimed.claim.claim_token;
  if (!claimToken) {
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      "결제 요청을 확인할 수 없습니다.",
    );
  }

  if (resultCode !== "00") {
    await failSubscriptionBillingCallback({
      orderId,
      claimToken,
      resultCode: resultCode || "MOBILE_BILLKEY_FAIL",
      resultMessage: resultMessage || "모바일 빌링키 발급 실패",
      rawResponse: safeCallback,
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      resultMessage || "모바일 결제에 실패했습니다.",
    );
  }

  const billKey = formString(form, "billkey", "CARD_BillKey", "P_BILLKEY");
  const issueTid = formString(form, "tid", "P_TID");
  const callbackAmount = formString(form, "price", "P_AMT");
  const bindingError = validateSubscriptionBillKeyBinding({
    expectedOrderId: orderId,
    expectedAmount: claimed.claim.history_amount_krw,
    expectedMid: config.mid,
    actualOrderId: formString(form, "orderid", "orderId", "P_OID"),
    actualAmount: callbackAmount || null,
    actualMid: mid,
    issueTid,
    requireAmount: false,
  });

  if (!billKey || bindingError) {
    const code = !billKey ? "BILLKEY_MISSING" : bindingError!;
    await failSubscriptionBillingCallback({
      orderId,
      claimToken,
      resultCode: code,
      resultMessage: "빌링키 발급 응답 검증에 실패했습니다.",
      rawResponse: safeCallback,
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      "빌링키 발급 응답을 확인할 수 없습니다.",
    );
  }

  const completed = await completeClaimedSubscriptionCharge({
    orderId,
    claim: claimed.claim,
    billKey,
    billKeyIssueTid: issueTid,
    pgMid: config.mid,
    cardCode: formString(form, "cardcd", "CARD_Code") || null,
    cardName: formString(form, "cardname", "CARD_Name") || null,
    cardNumber: formString(form, "cardno", "CARD_Num") || null,
    cardQuota: formString(form, "cardquota", "CARD_Quota") || null,
    issueResultCode: resultCode,
    issueResultMessage: resultMessage || "빌링키 발급 완료",
    issueAudit: safeCallback,
    buyerName: formString(form, "buyername", "buyerName") || null,
    buyerEmail: formString(form, "buyeremail", "buyerEmail") || null,
    buyerTel: formString(form, "buyertel", "buyerTel") || null,
    clientIp: getClientIp(req),
    baseUrl,
  });

  if (!completed.ok) {
    const uncertain =
      completed.error === "BILLING_OUTCOME_UNKNOWN" ||
      completed.error === "BILLING_PERSIST_UNKNOWN";
    return redirectToResult(
      baseUrl,
      orderId,
      uncertain ? "pending" : "fail",
      uncertain
        ? "승인 결과를 확인 중입니다. 자동으로 다시 결제하지 마세요."
        : "첫 정기결제 승인에 실패했습니다.",
    );
  }

  return redirectToResult(baseUrl, orderId, "success");
}

export function GET() {
  return NextResponse.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
