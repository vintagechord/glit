import { requestBillingPayment } from "@/lib/inicis/api";
import {
  failSubscriptionBillingCallback,
  finalizeSubscriptionBillingCallback,
  recordSubscriptionBillingUncertain,
  recordSubscriptionBillKeyForCallback,
  type SubscriptionCallbackClaim,
} from "@/lib/subscriptions/service";

export type SubscriptionGatewayData = Record<
  string,
  string | number | null | undefined
>;

const sensitiveKeyPattern =
  /(bill.?key|auth.?token|auth.?url|net.?cancel.?url|auth.?signature|signature|hash.?data|verification|m.?key|card.?num|cardno|cardpw|cardmembernum|regno|buyer(email|tel|name)|^p_?(uname|mobile|email)$|api.?key|api.?iv|sign.?key|data1|merchant(reserved|data)|callbackstate)/i;

export const normalizeSubscriptionAmount = (
  value: string | number | null | undefined,
) => {
  if (value == null) return Number.NaN;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const firstGatewayString = (
  data: SubscriptionGatewayData,
  keys: string[],
) => {
  for (const key of keys) {
    const value = data[key];
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
};

export const maskSubscriptionCardNumber = (
  value?: string | null,
) => {
  const normalized = (value ?? "").replace(/[^0-9*]/g, "");
  if (!normalized) return null;
  if (normalized.includes("*")) return normalized.slice(0, 24);
  if (normalized.length <= 4) return "*".repeat(normalized.length);
  if (normalized.length <= 10) {
    return `${normalized.slice(0, 2)}${"*".repeat(normalized.length - 4)}${normalized.slice(-2)}`;
  }
  return `${normalized.slice(0, 6)}${"*".repeat(normalized.length - 10)}${normalized.slice(-4)}`;
};

export const scrubSubscriptionGatewayPayload = (
  value: unknown,
): unknown => {
  if (Array.isArray(value)) {
    return value.map(scrubSubscriptionGatewayPayload);
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? "[REDACTED]"
        : scrubSubscriptionGatewayPayload(item),
    ]),
  );
};

export const validateSubscriptionBillKeyBinding = ({
  expectedOrderId,
  expectedAmount,
  expectedMid,
  actualOrderId,
  actualAmount,
  actualMid,
  issueTid,
  requireAmount,
}: {
  expectedOrderId: string;
  expectedAmount: number;
  expectedMid: string;
  actualOrderId?: string | null;
  actualAmount?: string | number | null;
  actualMid?: string | null;
  issueTid?: string | null;
  requireAmount: boolean;
}) => {
  if (!actualOrderId || actualOrderId !== expectedOrderId) {
    return "ORDER_ID_MISMATCH";
  }
  if (!actualMid || actualMid !== expectedMid) {
    return "MID_MISMATCH";
  }
  if (!issueTid?.trim()) {
    return "BILLKEY_TID_MISSING";
  }

  const normalizedAmount = normalizeSubscriptionAmount(actualAmount);
  if (
    (requireAmount && !Number.isFinite(normalizedAmount)) ||
    (Number.isFinite(normalizedAmount) && normalizedAmount !== expectedAmount)
  ) {
    return "AMOUNT_MISMATCH";
  }
  return null;
};

export const validateSubscriptionBillingCharge = ({
  response,
  expectedOrderId,
  expectedAmount,
  expectedMid,
}: {
  response: SubscriptionGatewayData;
  expectedOrderId: string;
  expectedAmount: number;
  expectedMid: string;
}) => {
  const tid = firstGatewayString(response, ["tid", "TID", "P_TID"]);
  if (!tid) return { error: "BILLING_TID_MISSING", tid: null };

  const actualAmount = normalizeSubscriptionAmount(
    response.price ?? response.TotPrice ?? response.P_AMT,
  );
  if (!Number.isFinite(actualAmount) || actualAmount !== expectedAmount) {
    return { error: "BILLING_AMOUNT_MISMATCH", tid: null };
  }

  const responseOrderId = firstGatewayString(response, [
    "moid",
    "MOID",
    "orderId",
    "orderid",
  ]);
  if (responseOrderId && responseOrderId !== expectedOrderId) {
    return { error: "BILLING_ORDER_ID_MISMATCH", tid: null };
  }

  const responseMid = firstGatewayString(response, ["mid", "MID"]);
  if (responseMid && responseMid !== expectedMid) {
    return { error: "BILLING_MID_MISMATCH", tid: null };
  }

  return { error: null, tid };
};

type CompleteSubscriptionChargeParams = {
  orderId: string;
  claim: SubscriptionCallbackClaim;
  billKey: string;
  billKeyIssueTid: string;
  pgMid: string;
  cardCode?: string | null;
  cardName?: string | null;
  cardNumber?: string | null;
  cardQuota?: string | null;
  issueResultCode?: string | null;
  issueResultMessage?: string | null;
  issueAudit: Record<string, unknown>;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerTel?: string | null;
  clientIp?: string | null;
  baseUrl: string;
};

export const completeClaimedSubscriptionCharge = async (
  params: CompleteSubscriptionChargeParams,
) => {
  const claimToken = params.claim.claim_token;
  if (!claimToken) {
    return { ok: false, error: "SUBSCRIPTION_CLAIM_TOKEN_MISSING" };
  }

  const safeIssueAudit = scrubSubscriptionGatewayPayload(
    params.issueAudit,
  ) as Record<string, unknown>;
  const billKeyRecord = await recordSubscriptionBillKeyForCallback({
    orderId: params.orderId,
    claimToken,
    billKey: params.billKey,
    billKeyIssueTid: params.billKeyIssueTid,
    pgMid: params.pgMid,
    cardCode: params.cardCode,
    cardName: params.cardName,
    cardNumber: maskSubscriptionCardNumber(params.cardNumber),
    cardQuota: params.cardQuota,
    resultCode: params.issueResultCode ?? "BILLKEY_ISSUED",
    resultMessage: params.issueResultMessage ?? "빌링키 발급 완료",
    rawResponse: safeIssueAudit,
  });

  if (billKeyRecord.error || !billKeyRecord.billing?.billing_id) {
    await failSubscriptionBillingCallback({
      orderId: params.orderId,
      claimToken,
      resultCode: "BILLKEY_STORE_FAIL",
      resultMessage: "빌링키 저장에 실패했습니다.",
      rawResponse: safeIssueAudit,
    });
    return { ok: false, error: "BILLKEY_STORE_FAIL" };
  }

  const billingResult = await requestBillingPayment({
    billKey: params.billKey,
    orderId: params.orderId,
    amountKrw: params.claim.history_amount_krw,
    goodName: params.claim.history_product_name ?? "Subscription",
    buyerName: params.buyerName ?? "회원",
    buyerEmail: params.buyerEmail,
    buyerTel: params.buyerTel,
    clientIp: params.clientIp,
    url: params.baseUrl,
  });
  const billingData = billingResult.data ?? {};
  const resultCode = firstGatewayString(billingData, ["resultCode", "resultcode"]);
  const resultMessage =
    firstGatewayString(billingData, ["resultMsg", "resultMessage", "resultmsg"]) ??
    "정기결제(빌링) 요청 실패";
  const safeBillingAudit = scrubSubscriptionGatewayPayload({
    ...safeIssueAudit,
    billing: billingData,
  }) as Record<string, unknown>;

  if (!billingResult.ok) {
    if (resultCode === "NETWORK_ERROR" || !resultCode) {
      await recordSubscriptionBillingUncertain({
        orderId: params.orderId,
        claimToken,
        resultCode: "BILLING_OUTCOME_UNKNOWN",
        resultMessage:
          "빌링 승인 결과를 확인할 수 없어 자동 재시도를 중단했습니다.",
        rawResponse: safeBillingAudit,
      });
      return { ok: false, error: "BILLING_OUTCOME_UNKNOWN" };
    }

    await failSubscriptionBillingCallback({
      orderId: params.orderId,
      claimToken,
      resultCode,
      resultMessage,
      rawResponse: safeBillingAudit,
    });
    return { ok: false, error: resultCode };
  }

  const binding = validateSubscriptionBillingCharge({
    response: billingData,
    expectedOrderId: params.orderId,
    expectedAmount: params.claim.history_amount_krw,
    expectedMid: params.pgMid,
  });
  if (binding.error || !binding.tid) {
    await recordSubscriptionBillingUncertain({
      orderId: params.orderId,
      claimToken,
      resultCode: binding.error ?? "BILLING_RESPONSE_INVALID",
      resultMessage:
        "승인 응답의 주문·금액·거래번호 검증에 실패해 자동 재시도를 중단했습니다.",
      rawResponse: safeBillingAudit,
    });
    return { ok: false, error: binding.error ?? "BILLING_RESPONSE_INVALID" };
  }

  const finalized = await finalizeSubscriptionBillingCallback({
    orderId: params.orderId,
    claimToken,
    billingTid: binding.tid,
    amountKrw: params.claim.history_amount_krw,
    resultCode: resultCode ?? "00",
    resultMessage,
    rawResponse: safeBillingAudit,
  });
  if (finalized.error || !finalized.finalized?.history_id) {
    await recordSubscriptionBillingUncertain({
      orderId: params.orderId,
      claimToken,
      resultCode: "BILLING_PERSIST_UNKNOWN",
      resultMessage:
        "빌링 승인은 완료됐으나 구독 반영 결과를 확인할 수 없습니다.",
      rawResponse: safeBillingAudit,
    });
    return { ok: false, error: "BILLING_PERSIST_UNKNOWN" };
  }

  return {
    ok: true,
    billingTid: binding.tid,
    alreadyFinalized: finalized.finalized.already_finalized,
  };
};
