import { NextRequest, NextResponse } from "next/server";

import {
  isInicisSuccessCode,
  requestStdPayApproval,
  requestStdPayNetCancel,
} from "@/lib/inicis/api";
import { readBoundedInicisCallbackForm } from "@/lib/inicis/callback-request";
import { getBillingConfig, getStdPayConfig } from "@/lib/inicis/config";
import {
  completeClaimedSubscriptionCharge,
  firstGatewayString,
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

const isTrustedInicisUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (host === "inicis.com" || host.endsWith(".inicis.com"))
    );
  } catch {
    return false;
  }
};

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const formResult = await readBoundedInicisCallbackForm(req);
  if (!formResult.ok) {
    return NextResponse.json(
      { error: "Invalid subscription billing callback payload." },
      { status: formResult.reason === "too_large" ? 413 : 400 },
    );
  }
  const form = formResult.form;

  const callbackPayload = Object.fromEntries(form.entries());
  const safeCallback = scrubSubscriptionGatewayPayload({
    callback: callbackPayload,
  }) as Record<string, unknown>;
  const orderId = formString(form, "oid", "orderNumber", "MOID");
  const callbackState = formExactString(
    form,
    "merchantData",
    "merchantdata",
  );
  const mid = formString(form, "mid", "MID");
  const callbackResultCode = formString(form, "resultCode", "resultcode");
  const callbackResultMessage = formString(form, "resultMsg", "resultmessage");

  if (!orderId || callbackState.length < 32 || !mid) {
    return NextResponse.json(
      { error: "Missing order, merchant state, or MID in billing callback." },
      { status: 400 },
    );
  }

  let stdConfig: ReturnType<typeof getStdPayConfig>;
  let billingConfig: ReturnType<typeof getBillingConfig>;
  try {
    stdConfig = getStdPayConfig();
    billingConfig = getBillingConfig();
  } catch (error) {
    console.error("[Inicis][subscription-pc] billing config unavailable", {
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

  if (
    mid !== stdConfig.mid ||
    billingConfig.mid !== stdConfig.mid
  ) {
    return redirectToResult(baseUrl, orderId, "fail", "MID mismatch");
  }

  const claimed = await claimSubscriptionBillingCallback({
    orderId,
    callbackState,
    channel: "PC",
  });
  if (claimed.error || !claimed.claim) {
    console.warn("[Inicis][subscription-pc] callback claim rejected", {
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
    return redirectToResult(baseUrl, orderId, "fail", "결제 요청을 확인할 수 없습니다.");
  }

  if (callbackResultCode && !isInicisSuccessCode(callbackResultCode)) {
    await failSubscriptionBillingCallback({
      orderId,
      claimToken,
      resultCode: callbackResultCode,
      resultMessage: callbackResultMessage || "빌링키 인증 실패",
      rawResponse: safeCallback,
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      callbackResultMessage || "빌링키 인증에 실패했습니다.",
    );
  }

  const authToken = formString(form, "authToken", "auth_token");
  const authUrl = formString(form, "authUrl");
  const netCancelUrl = formString(form, "netCancelUrl");
  const timestamp = formString(form, "timestamp", "tstamp");
  if (!authToken || !authUrl || !timestamp || !isTrustedInicisUrl(authUrl)) {
    await failSubscriptionBillingCallback({
      orderId,
      claimToken,
      resultCode: "INVALID_AUTH_CALLBACK",
      resultMessage: "승인 콜백 정보가 유효하지 않습니다.",
      rawResponse: safeCallback,
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      "승인 콜백 정보가 유효하지 않습니다.",
    );
  }

  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl: netCancelUrl || null,
    authToken,
    timestamp,
  });
  const authData = (approval.data ?? {}) as Record<
    string,
    string | number | null | undefined
  >;
  const authResultCode =
    firstGatewayString(authData, ["resultCode", "resultcode"]) ?? "AUTH_FAIL";
  const authResultMessage =
    firstGatewayString(authData, ["resultMsg", "resultmessage"]) ??
    "빌링키 발급 승인 실패";
  const safeApproval = scrubSubscriptionGatewayPayload({
    ...safeCallback,
    approval: authData,
  }) as Record<string, unknown>;

  if (
    !approval.ok ||
    !isInicisSuccessCode(authResultCode) ||
    approval.secureSignatureMatches !== true
  ) {
    if (approval.ok && isInicisSuccessCode(authResultCode) && netCancelUrl) {
      await requestStdPayNetCancel({ netCancelUrl, authToken, timestamp });
    }
    const code =
      approval.secureSignatureMatches !== true &&
      isInicisSuccessCode(authResultCode)
        ? "SIGNATURE_MISMATCH"
        : authResultCode;
    await failSubscriptionBillingCallback({
      orderId,
      claimToken,
      resultCode: code,
      resultMessage:
        code === "SIGNATURE_MISMATCH"
          ? "승인 서명 검증에 실패했습니다."
          : authResultMessage,
      rawResponse: safeApproval,
    });
    return redirectToResult(
      baseUrl,
      orderId,
      "fail",
      code === "SIGNATURE_MISMATCH"
        ? "결제 서명 검증에 실패했습니다."
        : authResultMessage,
    );
  }

  const billKey = firstGatewayString(authData, [
    "CARD_BillKey",
    "billKey",
    "BillKey",
    "P_BILLKEY",
  ]);
  const issueTid = firstGatewayString(authData, ["P_TID", "tid", "TID"]);
  const bindingError = validateSubscriptionBillKeyBinding({
    expectedOrderId: orderId,
    expectedAmount: claimed.claim.history_amount_krw,
    expectedMid: billingConfig.mid,
    actualOrderId: firstGatewayString(authData, ["MOID", "moid", "orderId"]),
    actualAmount: authData.TotPrice ?? authData.price,
    actualMid: firstGatewayString(authData, ["mid", "MID"]),
    issueTid,
    requireAmount: true,
  });

  if (!billKey || bindingError) {
    if (netCancelUrl) {
      await requestStdPayNetCancel({ netCancelUrl, authToken, timestamp });
    }
    const code = !billKey ? "BILLKEY_MISSING" : bindingError!;
    await failSubscriptionBillingCallback({
      orderId,
      claimToken,
      resultCode: code,
      resultMessage: "빌링키 발급 응답 검증에 실패했습니다.",
      rawResponse: safeApproval,
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
    billKeyIssueTid: issueTid!,
    pgMid: billingConfig.mid,
    cardCode: firstGatewayString(authData, ["CARD_Code", "cardCode"]),
    cardName: firstGatewayString(authData, ["CARD_Name", "cardName"]),
    cardNumber: firstGatewayString(authData, ["CARD_Num", "cardNumber"]),
    cardQuota: firstGatewayString(authData, ["CARD_Quota", "cardQuota"]),
    issueResultCode: authResultCode,
    issueResultMessage: authResultMessage,
    issueAudit: safeApproval,
    buyerName: firstGatewayString(authData, ["buyerName"]),
    buyerEmail: firstGatewayString(authData, ["buyerEmail"]),
    buyerTel: firstGatewayString(authData, ["buyerTel"]),
    clientIp: getClientIp(req),
    baseUrl,
  });

  if (!completed.ok) {
    if (completed.error === "BILLKEY_STORE_FAIL" && netCancelUrl) {
      await requestStdPayNetCancel({ netCancelUrl, authToken, timestamp });
    }
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
