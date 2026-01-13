import { NextRequest, NextResponse } from "next/server";

import { getBillingConfig } from "@/lib/inicis/config";
import { requestBillingPayment } from "@/lib/inicis/api";
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

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const form = await req.formData();
  const orderId =
    (form.get("orderid") as string | null) ??
    (form.get("P_OID") as string | null) ??
    "";
  const mid = (form.get("mid") as string | null) ?? "";
  const resultCode =
    (form.get("resultcode") as string | null) ??
    (form.get("resultCode") as string | null) ??
    (form.get("P_STATUS") as string | null) ??
    "";
  const resultMessage =
    (form.get("resultMsg") as string | null) ??
    (form.get("resultmessage") as string | null) ??
    (form.get("P_RMESG1") as string | null) ??
    "";
  const billKey =
    (form.get("billkey") as string | null) ??
    (form.get("CARD_BillKey") as string | null) ??
    (form.get("P_BILLKEY") as string | null) ??
    "";
  const tid =
    (form.get("tid") as string | null) ??
    (form.get("P_TID") as string | null) ??
    "";
  const priceRaw =
    (form.get("price") as string | null) ??
    (form.get("P_AMT") as string | null) ??
    "";
  const toCode = (value: string | number | null | undefined, fallback: string) =>
    value == null ? fallback : String(value);
  const toStrOrNull = (value: string | number | null | undefined) =>
    value == null ? null : String(value);

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

  const historyPrice = Number(history.amount_krw ?? 0);
  const paidPrice = Number(priceRaw ?? 0);
  const isSuccess = resultCode === "00" || resultCode === "0000";

  await updateHistory(orderId, {
    result_code: resultCode || "MOBILE_RETURN",
    result_message: resultMessage || "모바일 콜백 수신",
    raw_response: Object.fromEntries(form.entries()),
  });

  if (!isSuccess) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: resultCode || "FAIL",
      result_message: resultMessage || "모바일 결제 실패",
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
    });
    return failureResponse(baseUrl, orderId, "빌링키가 없습니다.", 400);
  }

  if (historyPrice > 0 && paidPrice > 0 && historyPrice !== paidPrice) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "PRICE_MISMATCH",
      result_message: `가격 불일치 (${paidPrice} != ${historyPrice})`,
    });
    return failureResponse(baseUrl, orderId, "결제 금액이 일치하지 않습니다.", 400);
  }

  const { billing, error: billingError } = await storeBillingKey({
    userId: history.user_id,
    billKey,
    pgTid: tid ?? null,
    pgMid: config.mid,
    lastResultCode: resultCode,
    lastResultMessage: resultMessage,
  });

  if (billingError || !billing) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "BILLING_STORE_FAIL",
      result_message: "빌링키 저장 실패",
    });
    return failureResponse(baseUrl, orderId, "빌링키 저장 실패", 500);
  }

  await updateHistory(orderId, {
    status: "BILLKEY_ISSUED",
    billing_id: billing.id,
    result_code: resultCode || "0000",
    result_message: resultMessage || "빌링키 발급 완료",
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
    raw_response: { billing: billingResult.data },
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
const tidPaid =
  billingData.tid ?? billingData.TID ?? billingData.P_TID ?? billingData.tid;
const tidPaidStr = tidPaid != null ? String(tidPaid) : null;

  const { subscription } = await activateSubscription({
    userId: history.user_id,
    billingId: billing.id,
    amountKrw: historyPrice,
    productName: history.product_name ?? "Subscription",
  });

await updateHistory(orderId, {
  status: "APPROVED",
  pg_tid: tidPaidStr,
  result_code: toCode(billingData.resultCode, "00"),
  result_message:
    billingData.resultMsg != null ? String(billingData.resultMsg) : "결제 완료",
  raw_response: { billing: billingData },
  billing_id: billing.id,
  subscription_id: subscription?.id ?? null,
  paid_at: new Date().toISOString(),
});

  return successRedirect(baseUrl, orderId, "success");
}

export const GET = POST;
