import { NextRequest, NextResponse } from "next/server";

import { getBillingConfig, getStdPayConfig } from "@/lib/inicis/config";
import {
  isInicisSuccessCode,
  requestBillingPayment,
  requestStdPayApproval,
} from "@/lib/inicis/api";
import {
  activateSubscription,
  getHistoryByOrderId,
  storeBillingKey,
  updateHistory,
} from "@/lib/subscriptions/service";
import { getBaseUrl, getClientIp } from "../../../../lib/url";

const successRedirect = (baseUrl: string, orderId: string, status: string) =>
  NextResponse.redirect(
    `${baseUrl}/subscription/result?orderId=${encodeURIComponent(orderId)}&status=${status}`,
  );

const failureResponse = (
  baseUrl: string,
  orderId: string,
  message: string,
  statusCode = 400,
) =>
  NextResponse.redirect(
    `${baseUrl}/subscription/result?orderId=${encodeURIComponent(orderId)}&status=fail&message=${encodeURIComponent(message)}`,
    { status: statusCode },
  );

const normalizeAmount = (value: string | number | null | undefined) => {
  if (value == null) return 0;
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const isTrustedInicisUrl = (value: string | null | undefined) => {
  if (!value) return false;
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

const toCode = (value: string | number | null | undefined, fallback: string) =>
  value == null ? fallback : String(value);

const toStrOrNull = (value: string | number | null | undefined) =>
  value == null ? null : String(value);

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const form = await req.formData().catch(() => {
    const fallback = new FormData();
    req.nextUrl.searchParams.forEach((value, key) => {
      fallback.append(key, value);
    });
    return fallback;
  });
  const callbackPayload = Object.fromEntries(form.entries());
  const authToken =
    (
      (form.get("authToken") as string | null) ??
      (form.get("auth_token") as string | null) ??
      ""
    ).trim();
  const authUrl = ((form.get("authUrl") as string | null) ?? "").trim();
  const netCancelUrl = ((form.get("netCancelUrl") as string | null) ?? "").trim();
  const orderId =
    (
      (form.get("oid") as string | null) ??
      (form.get("orderNumber") as string | null) ??
      ""
    ).trim();
  const mid = ((form.get("mid") as string | null) ?? "").trim();
  const timestamp =
    (
      (form.get("timestamp") as string | null) ??
      (form.get("tstamp") as string | null) ??
      Date.now().toString()
    ).trim();
  const tid = ((form.get("tid") as string | null) ?? "").trim();

  if (!authToken || !authUrl || !orderId) {
    return NextResponse.json(
      { error: "Invalid Inicis callback payload" },
      { status: 400 },
    );
  }
  if (!isTrustedInicisUrl(authUrl)) {
    return failureResponse(baseUrl, orderId, "승인 URL이 유효하지 않습니다.", 400);
  }

  const stdConfig = getStdPayConfig();
  const billingConfig = getBillingConfig();
  if (mid && mid !== stdConfig.mid) {
    return failureResponse(baseUrl, orderId, "MID mismatch", 400);
  }

  const { history, error: historyError } = await getHistoryByOrderId(orderId);
  if (historyError || !history) {
    return failureResponse(baseUrl, orderId, "Unknown order id", 404);
  }
  if (!history.user_id) {
    return failureResponse(baseUrl, orderId, "구독 사용자 정보를 찾을 수 없습니다.", 400);
  }

  const historyPrice = normalizeAmount(history.amount_krw ?? 0);
  if (!Number.isFinite(historyPrice) || historyPrice <= 0) {
    return failureResponse(baseUrl, orderId, "결제 금액이 유효하지 않습니다.", 400);
  }
  await updateHistory(orderId, {
    result_message: "Auth callback received",
    raw_response: { callback: callbackPayload },
  });

  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl,
    authToken,
    timestamp: String(timestamp),
  });

  if (!approval.ok || !approval.data) {
    const resultCodeStr =
      approval.data?.resultCode != null
        ? String(approval.data.resultCode)
        : "AUTH_FAIL";
    const resultMsgStr =
      approval.data?.resultMsg != null
        ? String(approval.data.resultMsg)
        : "Inicis approval failed. Please try again or contact support.";
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: resultCodeStr,
      result_message: resultMsgStr,
      raw_response: { callback: callbackPayload, approval: approval.data ?? null },
    });
    return failureResponse(
      baseUrl,
      orderId,
      resultMsgStr ?? "승인 요청이 실패했습니다.",
      400,
    );
  }

  const authData = approval.data as Record<string, string | number | null | undefined>;
  const authResultCode = toCode(authData.resultCode, "AUTH_FAIL");
  const authResultMsg = authData.resultMsg != null ? String(authData.resultMsg) : "승인 실패";
  if (!isInicisSuccessCode(authResultCode)) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: authResultCode,
      result_message: authResultMsg,
      raw_response: { callback: callbackPayload, approval: authData },
    });
    return failureResponse(baseUrl, orderId, authResultMsg, 400);
  }

  if (approval.secureSignatureMatches === false) {
    const authSignature =
      authData.authSignature != null
        ? String(authData.authSignature)
        : authData.AuthSignature != null
          ? String(authData.AuthSignature)
          : "";
    if (authSignature) {
      await updateHistory(orderId, {
        status: "FAILED",
        result_code: "SIGNATURE_MISMATCH",
        result_message: "승인 서명 검증에 실패했습니다.",
        raw_response: { callback: callbackPayload, approval: authData },
      });
      return failureResponse(baseUrl, orderId, "결제 서명 검증에 실패했습니다.", 400);
    }
  }

  const billKey =
    authData.CARD_BillKey ??
    authData.billKey ??
    authData.BillKey ??
    authData.P_BILLKEY ??
    null;
  const billKeyStr = billKey != null ? String(billKey).trim() : null;

  const totPrice = normalizeAmount(authData.TotPrice ?? authData.price ?? 0);

  if (!billKeyStr) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: toCode(authResultCode, "NO_BILLKEY"),
      result_message: "빌링키를 발급받지 못했습니다.",
      raw_response: { callback: callbackPayload, auth: authData },
    });
    return failureResponse(baseUrl, orderId, "빌링키 발급 실패", 400);
  }

  if (historyPrice > 0 && totPrice > 0 && historyPrice !== totPrice) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "PRICE_MISMATCH",
      result_message: `가격 불일치 (${totPrice} != ${historyPrice})`,
      raw_response: { callback: callbackPayload, auth: authData },
    });
    return failureResponse(baseUrl, orderId, "결제 금액이 일치하지 않습니다.", 400);
  }

  const authTid =
    toStrOrNull(
      authData.P_TID ??
        authData.tid ??
        authData.TID ??
        tid ??
        null,
    )?.trim() ?? null;
  if (!authTid) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "NO_TID",
      result_message: "승인 거래번호(TID)를 수신하지 못했습니다.",
      raw_response: { callback: callbackPayload, auth: authData },
    });
    return failureResponse(baseUrl, orderId, "승인 거래번호를 확인할 수 없습니다.", 400);
  }

  const { billing, error: billingError } = await storeBillingKey({
    userId: history.user_id,
    billKey: billKeyStr,
    pgTid: authTid,
    pgMid: billingConfig.mid,
    cardCode: toStrOrNull(authData.CARD_Code ?? authData.cardCode ?? null),
    cardName: toStrOrNull(authData.CARD_Name ?? authData.cardName ?? null),
    cardNumber: toStrOrNull(authData.CARD_Num ?? authData.cardNumber ?? null),
    cardQuota: toStrOrNull(authData.CARD_Quota ?? authData.cardQuota ?? null),
    lastResultCode: authData.resultCode != null ? String(authData.resultCode) : null,
    lastResultMessage: authData.resultMsg != null ? String(authData.resultMsg) : null,
  });

  if (billingError || !billing) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "BILLING_STORE_FAIL",
      result_message: "빌링키 저장 실패",
      raw_response: { callback: callbackPayload, auth: authData, billingError },
    });
    return failureResponse(baseUrl, orderId, "빌링키 저장에 실패했습니다.", 500);
  }

  await updateHistory(orderId, {
    status: "BILLKEY_ISSUED",
    billing_id: billing.id,
    result_code: toCode(authResultCode, "0000"),
    result_message:
      authData.resultMsg != null ? String(authData.resultMsg) : "빌링키 발급 완료",
    raw_response: { callback: callbackPayload, auth: authData },
  });

  const billKeyForBilling = billKeyStr ?? "";

  const billingResult = await requestBillingPayment({
    billKey: billKeyForBilling,
    orderId,
    amountKrw: historyPrice,
    goodName: history.product_name ?? "Subscription",
    buyerName: toStrOrNull(authData.buyerName) ?? "회원",
    buyerEmail: toStrOrNull(authData.buyerEmail),
    buyerTel: toStrOrNull(authData.buyerTel),
    clientIp: getClientIp(req),
    url: baseUrl,
  });

  if (!billingResult.ok || !billingResult.data) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: toCode(billingResult.data?.resultCode, "BILLING_FAIL"),
      result_message:
        billingResult.data?.resultMsg != null
          ? String(billingResult.data.resultMsg)
          : "정기결제(빌링) 요청 실패",
      raw_response: {
        callback: callbackPayload,
        auth: authData,
        billing: billingResult.data,
      },
    });
    return failureResponse(
      baseUrl,
      orderId,
      billingResult.data?.resultMsg != null
        ? String(billingResult.data.resultMsg)
        : "첫 결제 승인에 실패했습니다.",
      400,
    );
  }

  const billingData = billingResult.data as Record<string, string | number | null | undefined>;
  const tidPaid =
    billingData.tid ?? billingData.TID ?? billingData.P_TID ?? billingData.tid;
  const tidPaidStr = tidPaid != null ? String(tidPaid).trim() : null;
  if (!tidPaidStr) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "NO_TID",
      result_message: "빌링 결제 거래번호(TID)를 수신하지 못했습니다.",
      raw_response: {
        callback: callbackPayload,
        auth: authData,
        billing: billingData,
      },
    });
    return failureResponse(baseUrl, orderId, "빌링 결제 거래번호를 확인할 수 없습니다.", 400);
  }

  const { subscription, error: subscriptionError } = await activateSubscription({
    userId: history.user_id,
    billingId: billing.id,
    amountKrw: historyPrice,
    productName: history.product_name ?? "Subscription",
  });
  if (subscriptionError || !subscription) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "SUBSCRIPTION_ACTIVATE_FAIL",
      result_message: "구독 활성화에 실패했습니다.",
      raw_response: {
        callback: callbackPayload,
        auth: authData,
        billing: billingData,
        subscriptionError,
      },
    });
    return failureResponse(baseUrl, orderId, "구독 활성화에 실패했습니다.", 500);
  }

  await updateHistory(orderId, {
    status: "APPROVED",
    pg_tid: tidPaidStr,
    result_code: toCode(billingData.resultCode, "00"),
    result_message:
      billingData.resultMsg != null ? String(billingData.resultMsg) : "결제 완료",
    raw_response: { callback: callbackPayload, auth: authData, billing: billingData },
    billing_id: billing.id,
    subscription_id: subscription.id,
    paid_at: new Date().toISOString(),
  });

  return successRedirect(baseUrl, orderId, "success");
}

export const GET = POST;
