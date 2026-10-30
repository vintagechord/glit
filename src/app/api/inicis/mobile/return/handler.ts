import { NextRequest, NextResponse } from "next/server";

import {
  INICIS_CALLBACK_MAX_FIELDS,
  readBoundedInicisCallbackForm,
  validateInicisCallbackQuery,
} from "@/lib/inicis/callback-request";
import { getInicisCallbackBaseUrl } from "@/lib/inicis/callback-origin";
import { getStoredInicisCallbackState, verifyInicisCallbackState } from "@/lib/inicis/callback-state";
import { getInicisMobileHashKey, getStdPayConfig } from "@/lib/inicis/config";
import {
  decodeInicisMobileMerchantData,
  isTrustedInicisMobileRequestUrl,
  requestInicisMobileApproval,
  requestInicisMobileNetCancel,
  validateInicisMobileCardReceipt,
} from "@/lib/inicis/mobile";
import { scrubInicisPaymentAudit } from "@/lib/inicis/payment-audit";
import { canHandlePaymentApprovalCallback, getPaymentGroupSubmissionIds } from "@/lib/payment-group";
import { createPaymentResultGrant, setPaymentResultGrantCookie } from "@/lib/payment-result-grant";
import { claimInicisSubmissionApproval, settleInicisSubmissionApproval } from "@/lib/payments/inicis-approval";
import { sendPaidSubmissionNotificationsById } from "@/lib/payments/notifications";
import { getPaymentByOrderId, markPaymentFailure, markPaymentSuccess } from "@/lib/payments/submission";

type ReturnStatus = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

// The bridge URL only carries identifiers; never guest tokens or receipts.
type BridgePayload = {
  status: ReturnStatus;
  submissionId?: string | null;
  submissionIds?: string[] | null;
};

export type InicisMobileReturnDeps = {
  getConfig: () => { mid: string; env: "prod" | "stg" };
  getHashKey: () => string | null;
  getPaymentByOrderId: typeof getPaymentByOrderId;
  claim: typeof claimInicisSubmissionApproval;
  settle: typeof settleInicisSubmissionApproval;
  markPaymentSuccess: typeof markPaymentSuccess;
  markPaymentFailure: typeof markPaymentFailure;
  approve: typeof requestInicisMobileApproval;
  netCancel: typeof requestInicisMobileNetCancel;
  notify: typeof sendPaidSubmissionNotificationsById;
  createGrant: typeof createPaymentResultGrant;
  setGrantCookie: typeof setPaymentResultGrantCookie;
  skipNetCancel: () => boolean;
};

const defaultDeps: InicisMobileReturnDeps = {
  getConfig: () => {
    const config = getStdPayConfig();
    return { mid: config.mid, env: config.env };
  },
  getHashKey: getInicisMobileHashKey,
  getPaymentByOrderId,
  claim: claimInicisSubmissionApproval,
  settle: settleInicisSubmissionApproval,
  markPaymentSuccess,
  markPaymentFailure,
  approve: requestInicisMobileApproval,
  netCancel: requestInicisMobileNetCancel,
  notify: sendPaidSubmissionNotificationsById,
  createGrant: createPaymentResultGrant,
  setGrantCookie: setPaymentResultGrantCookie,
  skipNetCancel: () => String(process.env.INICIS_DEBUG_NO_CANCEL ?? "").toLowerCase() === "true",
};

class CallbackPayloadError extends Error {
  constructor(readonly status: 400 | 413) {
    super("Invalid or oversized Inicis mobile callback payload.");
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeAmount = (value: string | undefined) => {
  const text = (value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** INIpayMobile may deliver the authentication result by POST or GET. */
async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const query = validateInicisCallbackQuery(req.url);
  if (!query.ok) throw new CallbackPayloadError(query.reason === "too_large" ? 413 : 400);
  const params: Record<string, string> = {};
  if (req.method === "POST" && req.body) {
    const form = await readBoundedInicisCallbackForm(req);
    if (!form.ok) throw new CallbackPayloadError(form.reason === "too_large" ? 413 : 400);
    for (const [key, value] of form.form.entries()) if (typeof value === "string") params[key] = value;
  }
  query.params.forEach((value, key) => {
    if (key in params && params[key] !== value) throw new CallbackPayloadError(400);
    if (!(key in params)) params[key] = value;
  });
  if (Object.keys(params).length > INICIS_CALLBACK_MAX_FIELDS) throw new CallbackPayloadError(413);
  return params;
}

const buildBridgeRedirect = (baseUrl: string, payload: BridgePayload) => {
  const url = new URL("/pay/inicis/return", baseUrl);
  url.searchParams.set("status", payload.status);
  if (payload.submissionId) url.searchParams.set("submissionId", payload.submissionId);
  if (payload.submissionIds?.length) url.searchParams.set("submissionIds", payload.submissionIds.join(","));
  const response = NextResponse.redirect(url.toString(), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

export async function handleInicisMobileReturn(req: NextRequest, deps: InicisMobileReturnDeps = defaultDeps) {
  const baseUrl = getInicisCallbackBaseUrl(req);
  let claimed: { orderId: string; closeState: string } | null = null;
  try {
    const params = await readParams(req);
    const status = (params.P_STATUS ?? "").trim();
    const message = (params.P_RMESG1 ?? "").trim();
    const authTid = (params.P_TID ?? "").trim();
    const amountFromReturn = normalizeAmount(params.P_AMT);
    const idcName = (params.idc_name ?? "").trim();
    const requestUrl = (params.P_REQ_URL ?? "").trim();
    const merchant = decodeInicisMobileMerchantData((params.P_NOTI ?? "").trim());
    const returnAudit = () => scrubInicisPaymentAudit({ returnParams: params, channel: "mobile" });

    console.info("[INICIS][mobile][callback_received]", {
      method: req.method, status, hasTid: Boolean(authTid), idcName,
      requestHost: requestUrl ? (() => { try { return new URL(requestUrl).host; } catch { return "invalid"; } })() : null,
      orderId: merchant?.orderId ?? null,
    });

    if (!merchant) return buildBridgeRedirect(baseUrl, { status: "FAIL" });
    const { orderId, closeState } = merchant;
    const { payment, error } = await deps.getPaymentByOrderId(orderId);
    if (error || !payment) return buildBridgeRedirect(baseUrl, { status: "FAIL" });

    const submissionId: string | null = payment.submission?.id ?? null;
    const guestToken: string | null = payment.submission?.guest_token ?? null;
    const paidSubmissionIds = getPaymentGroupSubmissionIds(payment)
      .filter((id) => uuidPattern.test(id)).slice(0, 100);
    const rawResponse = isRecord(payment.raw_response) ? payment.raw_response : null;
    const stateVerified = verifyInicisCallbackState({
      storedState: getStoredInicisCallbackState(rawResponse),
      receivedState: closeState,
    });
    if (!stateVerified || rawResponse?.channel !== "mobile") {
      console.warn("[INICIS][mobile][callback_rejected]", { orderId, stateVerified, channel: rawResponse?.channel ?? null });
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }

    const withGrant = (payload: BridgePayload, verified: boolean) => {
      const response = buildBridgeRedirect(baseUrl, payload);
      if (!verified || !submissionId || !guestToken) return response;
      const grant = deps.createGrant({ provider: "inicis", submissionId, orderId, guestToken });
      if (grant) deps.setGrantCookie(response, grant);
      return response;
    };

    if (payment.status === "APPROVED") {
      for (const paidId of paidSubmissionIds) await deps.notify({ submissionId: paidId, paymentKey: orderId });
      return buildBridgeRedirect(baseUrl, { status: "SUCCESS", submissionId, submissionIds: paidSubmissionIds });
    }
    if (!canHandlePaymentApprovalCallback(payment.status)) {
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }

    const paymentAmount = Math.round(Number(payment.amount_krw ?? NaN));
    const config = deps.getConfig();
    const saveFailure = async (
      code: string, resultMessage: string, audit: Record<string, unknown>, confirmedFailure: boolean,
    ) => {
      if (claimed) {
        await deps.settle({ orderId, callbackState: closeState, confirmedFailure, resultCode: code, resultMessage, rawResponse: audit });
      } else {
        await deps.markPaymentFailure(orderId, { result_code: code, result_message: resultMessage, raw_response: audit });
      }
    };

    if (status !== "00") {
      const canceled = /취소|cancel/i.test(message) || status === "01";
      await saveFailure(status || "AUTH_FAIL", message || "결제 인증이 완료되지 않았습니다.", returnAudit(), true);
      return buildBridgeRedirect(baseUrl, { status: canceled ? "CANCEL" : "FAIL", submissionId });
    }
    if (!authTid) {
      await saveFailure("AUTH_MISSING", "인증 거래번호를 받지 못했습니다.", returnAudit(), true);
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }
    if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 ||
        (Number.isFinite(amountFromReturn) && amountFromReturn > 0 && amountFromReturn !== paymentAmount)) {
      await saveFailure("PRICE_MISMATCH", `금액 불일치 (${amountFromReturn} != ${paymentAmount})`,
        scrubInicisPaymentAudit({ returnParams: params, phase: "pre_auth", expected: paymentAmount, received: amountFromReturn }), true);
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }
    if (!isTrustedInicisMobileRequestUrl(requestUrl, idcName, config.env)) {
      await saveFailure("INVALID_REQ_URL", "승인 요청 경로를 검증할 수 없습니다.", returnAudit(), true);
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }

    // Claim under the payment row lock before contacting the gateway so a
    // replayed or concurrent result can never approve twice.
    const claim = await deps.claim(orderId, closeState);
    if (!claim || claim.alreadyProcessing || claim.alreadyApproved) {
      if (claim?.alreadyApproved) {
        for (const paidId of paidSubmissionIds) await deps.notify({ submissionId: paidId, paymentKey: orderId });
      }
      return buildBridgeRedirect(baseUrl, {
        status: claim?.alreadyApproved ? "SUCCESS" : "ERROR", submissionId,
        submissionIds: claim?.alreadyApproved ? paidSubmissionIds : undefined,
      });
    }
    claimed = { orderId, closeState };

    const hashKey = deps.getHashKey();
    const compensate = async (reason: string) => {
      if (deps.skipNetCancel()) {
        console.warn("[INICIS][mobile][net_cancel] skipped by debug setting", { orderId, reason });
        return { ok: false, skipped: true as const, data: null };
      }
      if (!hashKey) return { ok: false, skipped: true as const, data: null };
      const cancellation = await deps.netCancel({
        requestUrl, idcName, mode: config.env, mid: config.mid, authTid, orderId, amountKrw: paymentAmount, hashKey,
      });
      if (!cancellation.ok) console.error("[INICIS][mobile][net_cancel] compensation failed", { orderId, reason });
      return { ok: cancellation.ok, skipped: false as const, data: scrubInicisPaymentAudit({ data: cancellation.data }) };
    };

    const approval = await deps.approve({ requestUrl, idcName, mode: config.env, mid: config.mid, authTid })
      .catch((error: unknown) => ({ ok: false, data: null, confirmedFailure: false, error }));
    const data = approval.data;
    if (!approval.ok || !data) {
      // A rejection with a gateway status is final. Timeouts and unreadable
      // bodies are not; attempt the documented net cancel first.
      const compensation = approval.confirmedFailure ? null : await compensate("approval_unknown");
      const confirmed = approval.confirmedFailure === true || compensation?.ok === true;
      await saveFailure(
        data?.P_STATUS || "APPROVAL_FAILED",
        data?.P_RMESG1 || "승인 요청 결과를 확인하지 못했습니다.",
        scrubInicisPaymentAudit({ returnParams: params, approval: data, compensation }),
        confirmed,
      );
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }

    const bindingError = validateInicisMobileCardReceipt(data, { mid: config.mid, orderId, amountKrw: paymentAmount });
    if (bindingError) {
      const compensation = await compensate(bindingError);
      await saveFailure(
        bindingError.startsWith("ORDER_ID_") ? "ORDER_MISMATCH" : bindingError,
        "승인된 결제 정보가 결제 요청과 일치하지 않습니다.",
        scrubInicisPaymentAudit({ returnParams: params, approval: data, bindingError, expectedAmount: paymentAmount, approvedAmount: data.P_AMT, compensation }),
        compensation.ok,
      );
      return buildBridgeRedirect(baseUrl, { status: "FAIL", submissionId });
    }

    const success = await deps.markPaymentSuccess(orderId, {
      tid: data.P_TID,
      result_code: "00",
      result_message: data.P_RMESG1 || "결제 완료",
      raw_response: scrubInicisPaymentAudit({ returnParams: params, approval: data, channel: "mobile" }),
    });
    if (!success.ok) {
      // The charge may have been recorded despite the lost response. Keep it
      // for reconciliation; never net-cancel a possibly paid order here.
      await deps.settle({
        orderId, callbackState: closeState, confirmedFailure: false,
        resultCode: "PERSIST_FAIL", resultMessage: "승인 후 저장 처리에 실패했습니다. 거래 내역 대조가 필요합니다.",
        rawResponse: scrubInicisPaymentAudit({ returnParams: params, approval: data }),
      });
      console.error("[INICIS][mobile][persist][error]", { orderId, submissionId, error: success.error ?? null });
      return withGrant({ status: "FAIL", submissionId }, true);
    }

    console.info("[INICIS][mobile][final]", { orderId, status: "APPROVED" });
    return withGrant({ status: "SUCCESS", submissionId, submissionIds: paidSubmissionIds }, true);
  } catch (error) {
    if (error instanceof CallbackPayloadError) {
      return NextResponse.json({ error: "Invalid Inicis mobile callback payload." }, { status: error.status });
    }
    if (claimed) {
      await deps.settle({
        orderId: claimed.orderId, callbackState: claimed.closeState, confirmedFailure: false,
        resultCode: "APPROVAL_EXCEPTION", resultMessage: "결제 승인 결과를 확인해야 합니다.",
      }).catch(() => false);
    }
    console.error("[INICIS][mobile][final][error]", error);
    return buildBridgeRedirect(baseUrl, { status: "ERROR" });
  }
}
