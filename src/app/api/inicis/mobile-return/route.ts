import { NextRequest, NextResponse } from "next/server";

import { isInicisSuccessCode, requestBillingPayment } from "@/lib/inicis/api";
import { getBillingConfig } from "@/lib/inicis/config";
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

const toCode = (value: string | number | null | undefined, fallback: string) =>
  value == null ? fallback : String(value);

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

  const orderId = (
    (form.get("orderid") as string | null) ??
    (form.get("P_OID") as string | null) ??
    ""
  ).trim();
  const mid = ((form.get("mid") as string | null) ?? "").trim();
  const resultCode = (
    (form.get("resultcode") as string | null) ??
    (form.get("resultCode") as string | null) ??
    (form.get("P_STATUS") as string | null) ??
    ""
  ).trim();
  const resultMessage = (
    (form.get("resultMsg") as string | null) ??
    (form.get("resultmessage") as string | null) ??
    (form.get("P_RMESG1") as string | null) ??
    ""
  ).trim();
  const billKey = (
    (form.get("billkey") as string | null) ??
    (form.get("CARD_BillKey") as string | null) ??
    (form.get("P_BILLKEY") as string | null) ??
    ""
  ).trim();
  const tid = (
    (form.get("tid") as string | null) ??
    (form.get("P_TID") as string | null) ??
    ""
  ).trim();
  const priceRaw = (
    (form.get("price") as string | null) ??
    (form.get("P_AMT") as string | null) ??
    ""
  ).trim();

  if (!orderId) {
    return NextResponse.json(
      { error: "Missing order id in mobile callback" },
      { status: 400 },
    );
  }

  const config = getBillingConfig();
  if (mid && mid !== config.mid) {
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
  const paidPrice = normalizeAmount(priceRaw ?? 0);
  const isSuccess = isInicisSuccessCode(resultCode);
  if (!Number.isFinite(historyPrice) || historyPrice <= 0) {
    return failureResponse(baseUrl, orderId, "결제 금액이 유효하지 않습니다.", 400);
  }

  await updateHistory(orderId, {
    result_code: resultCode || "MOBILE_RETURN",
    result_message: resultMessage || "모바일 콜백 수신",
    raw_response: { callback: callbackPayload },
  });

  if (!isSuccess) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: resultCode || "FAIL",
      result_message: resultMessage || "모바일 결제 실패",
      raw_response: { callback: callbackPayload },
    });
    return failureResponse(
      baseUrl,
      orderId,
      resultMessage || "모바일 결제 실패",
      400,
    );
  }

  if (!billKey) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "NO_BILLKEY",
      result_message: "빌링키가 전달되지 않았습니다.",
      raw_response: { callback: callbackPayload },
    });
    return failureResponse(baseUrl, orderId, "빌링키가 없습니다.", 400);
  }

  if (historyPrice > 0 && paidPrice > 0 && historyPrice !== paidPrice) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "PRICE_MISMATCH",
      result_message: `가격 불일치 (${paidPrice} != ${historyPrice})`,
      raw_response: { callback: callbackPayload },
    });
    return failureResponse(baseUrl, orderId, "결제 금액이 일치하지 않습니다.", 400);
  }

  if (!tid) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "NO_TID",
      result_message: "승인 거래번호(TID)를 수신하지 못했습니다.",
      raw_response: { callback: callbackPayload },
    });
    return failureResponse(baseUrl, orderId, "승인 거래번호를 확인할 수 없습니다.", 400);
  }

  const { billing, error: billingError } = await storeBillingKey({
    userId: history.user_id,
    billKey,
    pgTid: tid,
    pgMid: config.mid,
    lastResultCode: resultCode || "0000",
    lastResultMessage: resultMessage || "빌링키 발급 완료",
  });

  if (billingError || !billing) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "BILLING_STORE_FAIL",
      result_message: "빌링키 저장 실패",
      raw_response: { callback: callbackPayload, billingError },
    });
    return failureResponse(baseUrl, orderId, "빌링키 저장 실패", 500);
  }

  await updateHistory(orderId, {
    status: "BILLKEY_ISSUED",
    billing_id: billing.id,
    result_code: resultCode || "0000",
    result_message: resultMessage || "빌링키 발급 완료",
    raw_response: { callback: callbackPayload },
  });

  const billingResult = await requestBillingPayment({
    billKey,
    orderId,
    amountKrw: historyPrice,
    goodName: history.product_name ?? "Subscription",
    buyerName: history.product_name ?? "회원",
    buyerEmail: null,
    buyerTel: null,
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
      raw_response: { callback: callbackPayload, billing: billingResult.data },
    });
    return failureResponse(
      baseUrl,
      orderId,
      billingResult.data?.resultMsg != null
        ? String(billingResult.data.resultMsg)
        : "첫 결제 승인 실패",
      400,
    );
  }

  const billingData = billingResult.data as Record<string, string | number | null | undefined>;
  const tidPaid = billingData.tid ?? billingData.TID ?? billingData.P_TID ?? billingData.tid;
  const tidPaidStr = tidPaid != null ? String(tidPaid).trim() : null;
  if (!tidPaidStr) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "NO_TID",
      result_message: "빌링 결제 거래번호(TID)를 수신하지 못했습니다.",
      raw_response: { callback: callbackPayload, billing: billingData },
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
    raw_response: { callback: callbackPayload, billing: billingData },
    billing_id: billing.id,
    subscription_id: subscription.id,
    paid_at: new Date().toISOString(),
  });

  return successRedirect(baseUrl, orderId, "success");
}

export const GET = POST;
