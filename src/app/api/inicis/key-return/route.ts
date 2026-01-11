import { NextRequest, NextResponse } from "next/server";

import { getBillingConfig, getStdPayConfig } from "@/lib/inicis/config";
import { requestBillingPayment, requestStdPayApproval } from "@/lib/inicis/api";
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
  const authToken =
    (form.get("authToken") as string | null) ??
    (form.get("auth_token") as string | null) ??
    "";
  const authUrl = (form.get("authUrl") as string | null) ?? "";
  const netCancelUrl = (form.get("netCancelUrl") as string | null) ?? "";
  const orderId =
    (form.get("oid") as string | null) ??
    (form.get("orderNumber") as string | null) ??
    "";
  const mid = (form.get("mid") as string | null) ?? "";
  const timestamp =
    (form.get("timestamp") as string | null) ??
    (form.get("tstamp") as string | null) ??
    Date.now().toString();
  const tid = (form.get("tid") as string | null) ?? "";

  if (!authToken || !authUrl || !orderId) {
    return NextResponse.json(
      { error: "Invalid Inicis callback payload" },
      { status: 400 },
    );
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

  const historyPrice = Number(history.amount_krw ?? 0);
  await updateHistory(orderId, {
    result_message: "Auth callback received",
    raw_response: Object.fromEntries(form.entries()),
  });

  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl,
    authToken,
    timestamp: String(timestamp),
  });

  if (!approval.ok || !approval.data) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: approval.data?.resultCode ?? "AUTH_FAIL",
      result_message:
        approval.data?.resultMsg ??
        "Inicis approval failed. Please try again or contact support.",
    });
    return failureResponse(
      baseUrl,
      orderId,
      approval.data?.resultMsg ?? "승인 요청이 실패했습니다.",
      400,
    );
  }

  const authData = approval.data as Record<string, any>;
  const billKey =
    authData.CARD_BillKey ??
    authData.billKey ??
    authData.BillKey ??
    authData.P_BILLKEY ??
    null;

  const totPrice = Number(authData.TotPrice ?? authData.price ?? 0);

  if (!billKey) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: authData.resultCode ?? "NO_BILLKEY",
      result_message: "빌링키를 발급받지 못했습니다.",
      raw_response: { auth: authData },
    });
    return failureResponse(baseUrl, orderId, "빌링키 발급 실패", 400);
  }

  if (historyPrice > 0 && totPrice > 0 && historyPrice !== totPrice) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "PRICE_MISMATCH",
      result_message: `가격 불일치 (${totPrice} != ${historyPrice})`,
      raw_response: { auth: authData },
    });
    return failureResponse(baseUrl, orderId, "결제 금액이 일치하지 않습니다.", 400);
  }

  const { billing, error: billingError } = await storeBillingKey({
    userId: history.user_id,
    billKey,
    pgTid: authData.tid ?? tid ?? null,
    pgMid: billingConfig.mid,
    cardCode: authData.CARD_Code ?? authData.cardCode ?? null,
    cardName: authData.CARD_Name ?? authData.cardName ?? null,
    cardNumber: authData.CARD_Num ?? authData.cardNumber ?? null,
    cardQuota: authData.CARD_Quota ?? authData.cardQuota ?? null,
    lastResultCode: authData.resultCode ?? null,
    lastResultMessage: authData.resultMsg ?? null,
  });

  if (billingError || !billing) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: "BILLING_STORE_FAIL",
      result_message: "빌링키 저장 실패",
      raw_response: { auth: authData, billingError },
    });
    return failureResponse(baseUrl, orderId, "빌링키 저장에 실패했습니다.", 500);
  }

  await updateHistory(orderId, {
    status: "BILLKEY_ISSUED",
    billing_id: billing.id,
    result_code: authData.resultCode ?? "0000",
    result_message: authData.resultMsg ?? "빌링키 발급 완료",
    raw_response: { auth: authData },
  });

  const billingResult = await requestBillingPayment({
    billKey,
    orderId,
    amountKrw: historyPrice,
    goodName: history.product_name ?? "Subscription",
    buyerName: authData.buyerName ?? "회원",
    buyerEmail: authData.buyerEmail ?? null,
    buyerTel: authData.buyerTel ?? null,
    clientIp: getClientIp(req),
    url: baseUrl,
  });

  if (!billingResult.ok || !billingResult.data) {
    await updateHistory(orderId, {
      status: "FAILED",
      result_code: billingResult.data?.resultCode ?? "BILLING_FAIL",
      result_message:
        billingResult.data?.resultMsg ?? "정기결제(빌링) 요청 실패",
      raw_response: { auth: authData, billing: billingResult.data },
    });
    return failureResponse(
      baseUrl,
      orderId,
      billingResult.data?.resultMsg ?? "첫 결제 승인에 실패했습니다.",
      400,
    );
  }

  const billingData = billingResult.data as Record<string, any>;
  const tidPaid =
    billingData.tid ?? billingData.TID ?? billingData.P_TID ?? billingData.tid;

  const { subscription } = await activateSubscription({
    userId: history.user_id,
    billingId: billing.id,
    amountKrw: historyPrice,
    productName: history.product_name ?? "Subscription",
  });

  await updateHistory(orderId, {
    status: "APPROVED",
    pg_tid: tidPaid ?? null,
    result_code: billingData.resultCode ?? "00",
    result_message: billingData.resultMsg ?? "결제 완료",
    raw_response: { auth: authData, billing: billingData },
    billing_id: billing.id,
    subscription_id: subscription?.id ?? null,
    paid_at: new Date().toISOString(),
  });

  return successRedirect(baseUrl, orderId, "success");
}

export const GET = POST;
