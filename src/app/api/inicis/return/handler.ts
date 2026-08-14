import { NextRequest, NextResponse } from "next/server";

import {
  requestStdPayApproval,
  requestStdPayNetCancel,
} from "@/lib/inicis/api";
import { getStdPayConfig } from "@/lib/inicis/config";
import {
  getInicisTimestamp,
  makeAuthSecureSignature,
  sha256,
} from "@/lib/inicis/crypto";
import {
  getStoredInicisCallbackState,
  verifyInicisCallbackState,
} from "@/lib/inicis/callback-state";
import {
  INICIS_CALLBACK_MAX_FIELDS,
  readBoundedInicisCallbackForm,
  validateInicisCallbackQuery,
} from "@/lib/inicis/callback-request";
import { scrubInicisPaymentAudit } from "@/lib/inicis/payment-audit";
import {
  getPaymentByOrderId,
  markPaymentFailure,
  markPaymentSuccess,
} from "@/lib/payments/submission";
import {
  getKaraokePaymentByOrderId,
  markKaraokePaymentFailure,
  markKaraokePaymentSuccess,
} from "@/lib/payments/karaoke";
import {
  canHandlePaymentApprovalCallback,
  getPaymentGroupSubmissionIds,
} from "@/lib/payment-group";
import { validateGatewayPaymentBinding } from "@/lib/payment-integrity";
import {
  createPaymentResultGrant,
  setPaymentResultGrantCookie,
} from "@/lib/payment-result-grant";
import { getBaseUrl } from "@/lib/url";
import { isInicisSuccessCode } from "@/lib/inicis/api";

type ReturnStatus = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

type BridgePayload = {
  status: ReturnStatus;
  orderId?: string | null;
  submissionId?: string | null;
  submissionIds?: string[] | null;
  requestId?: string | null;
  message?: string | null;
  resultCode?: string | null;
  tid?: string | null;
  amount?: number | null;
};

type ParsedReturn = {
  baseUrl: string;
  method: string;
  contentType: string;
  params: Record<string, string>;
  keys: string[];
};

class InicisCallbackPayloadError extends Error {
  constructor(readonly status: 400 | 413) {
    super("Invalid or oversized Inicis callback payload.");
  }
}

const mask = (value: string | null | undefined, visible = 2) => {
  if (!value) return "";
  if (value.length <= visible) return `${value[0] ?? ""}*`;
  const head = value.slice(0, visible);
  const tail = value.slice(-visible);
  return `${head}${"*".repeat(Math.max(1, value.length - visible * 2))}${tail}`;
};

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

const scrubParams = (params: Record<string, string>) =>
  scrubInicisPaymentAudit(params);

const buildBridgeRedirect = (baseUrl: string, payload: BridgePayload) => {
  const url = new URL("/pay/inicis/return", baseUrl);
  url.searchParams.set("status", payload.status);
  if (payload.submissionId) url.searchParams.set("submissionId", payload.submissionId);
  if (payload.submissionIds?.length) {
    url.searchParams.set("submissionIds", payload.submissionIds.join(","));
  }
  if (payload.requestId) url.searchParams.set("requestId", payload.requestId);
  return NextResponse.redirect(url.toString(), 303);
};

// Parses STDPay callback payloads (form POST or query) for downstream approval handling.
const parseParams = async (req: NextRequest): Promise<ParsedReturn> => {
  const baseUrl = getBaseUrl(req);
  const contentType = req.headers.get("content-type") ?? "";
  const method = req.method;
  let params: Record<string, string> = {};
  let keys: string[] = [];
  const query = validateInicisCallbackQuery(req.url);
  if (!query.ok) throw new InicisCallbackPayloadError(413);

  if (method === "POST" && req.body) {
    const formResult = await readBoundedInicisCallbackForm(req);
    if (!formResult.ok) {
      throw new InicisCallbackPayloadError(
        formResult.reason === "too_large" ? 413 : 400,
      );
    }
    keys = Array.from(formResult.form.keys());
    params = Object.fromEntries(formResult.form.entries()) as Record<
      string,
      string
    >;
  }

  if (!Object.keys(params).length) {
    const queryParams = Object.fromEntries(query.params.entries());
    params = queryParams;
    keys = Object.keys(queryParams);
  } else {
    if (
      keys.length + Array.from(query.params.keys()).length >
      INICIS_CALLBACK_MAX_FIELDS
    ) {
      throw new InicisCallbackPayloadError(413);
    }
    // Merge in query params without overriding POSTed values
    query.params.forEach((value, key) => {
      if (!(key in params)) params[key] = value;
      if (!keys.includes(key)) keys.push(key);
    });
  }

  if (keys.length > INICIS_CALLBACK_MAX_FIELDS) {
    throw new InicisCallbackPayloadError(413);
  }

  return { baseUrl, contentType, method, params, keys };
};

const toCode = (value: string | number | null | undefined, fallback: string) =>
  value == null ? fallback : String(value);

const toStrOrNull = (value: string | number | null | undefined) =>
  value == null ? null : String(value);

export async function handleInicisReturn(req: NextRequest) {
  let parsed: ParsedReturn | null = null;
  try {
    parsed = await parseParams(req);
    const { baseUrl, contentType, method, params, keys } = parsed;

    const orderId = (
      params.orderNumber ?? params.oid ?? params.orderid ?? params.MOID ?? ""
    ).trim();
    const mid = (params.mid ?? "").trim();
    const authToken =
      (
        params.authToken ?? params.auth_token ?? params.authtoken ?? ""
      ).trim();
    const authUrlFromReturn =
      (params.authUrl ?? params.auth_url ?? params.authurl ?? "").trim();
    const checkAckUrl = (params.checkAckUrl ?? params.checkAckURL ?? "").trim();
    const approvalUrl =
      authUrlFromReturn ||
      checkAckUrl ||
      "";
    // FIX: use authUrl instead of checkAckUrl for approval (2026-01-21)
    const netCancelUrl = (
      params.netCancelUrl ??
      params.netCancelURL ??
      params.netcancelurl ??
      params.NetCancelURL ??
      ""
    ).trim();
    const resultCode = (
      params.resultCode ?? params.resultcode ?? params.P_STATUS ?? ""
    ).trim();
    const resultMsg = (
      params.resultMsg ?? params.resultmsg ?? params.P_RMESG1 ?? ""
    ).trim();
    const cancelFlag = params.cancel === "1" || params.cancel === "true";
    const tidFromReturn = (
      params.tid ??
      params.TID ??
      params.P_TID ??
      params.PG_TID ??
      params.CARD_TID ??
      ""
    ).trim();
    const amountFromReturn = normalizeAmount(
      params.price ?? params.TotPrice ?? params.P_AMT ?? 0,
    );
    const orderTimestampFromId = (() => {
      const parts = orderId.split("-");
      if (parts.length >= 3 && /^\d+$/.test(parts[1])) return parts[1];
      return null;
    })();
    const timestamp = String(
      params.tstamp ?? params.timestamp ?? orderTimestampFromId ?? getInicisTimestamp(),
    );
    // FIX: reuse orderId timestamp for approval signature (2026-01-21)

    const pick = (k: string) => (typeof params[k] === "string" ? String(params[k]) : "");

    const config = getStdPayConfig();
    const envSuffix = config.env === "prod" ? "PROD" : "STG";
    const looksHashedKey = /^[0-9a-fA-F]{64}$/.test(config.signKey ?? "");

    if (looksHashedKey) {
      console.warn("[INICIS][warn] signKey_looks_like_hashed_key", {
        env: envSuffix,
      });
    }

    const approvalHost = approvalUrl
      ? (() => {
          try {
            const u = new URL(approvalUrl);
            return `${u.host}${u.pathname}`;
          } catch {
            return null;
          }
        })()
      : null;

    console.info("[INICIS][callback_received]", {
      env: envSuffix,
      method,
      contentType,
      orderId,
      resultCode,
      hasAuthToken: Boolean(authToken),
      hasAuthUrl: Boolean(authUrlFromReturn),
      hasCheckAckUrl: Boolean(checkAckUrl),
      hasApprovalUrl: Boolean(approvalUrl),
      netCancelUrl: Boolean(netCancelUrl),
      tid: tidFromReturn ? mask(tidFromReturn) : null,
      mid: mid ? mask(mid) : null,
      tstamp: pick("tstamp") || null,
      totPrice: amountFromReturn || null,
      keys,
      midConfig: mask(config.mid),
      stdJsUrl: config.stdJsUrl,
      approvalHost,
    });

    const { payment: submissionPayment, error: paymentError } = orderId
      ? await getPaymentByOrderId(orderId)
      : { payment: null, error: null };
    const { payment: karaokePayment } = orderId && !submissionPayment ? await getKaraokePaymentByOrderId(orderId) : { payment: null };
    const submissionId = submissionPayment?.submission?.id ?? null;
    const paidSubmissionIds = submissionPayment
      ? getPaymentGroupSubmissionIds(submissionPayment)
          .filter((id) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              id,
            ),
          )
          .slice(0, 100)
      : [];
    const guestToken = submissionPayment?.submission?.guest_token ?? null;
    const karaokeRequestId = karaokePayment?.request?.id ?? null;
    const receivedCallbackState =
      params.merchantData ?? params.merchantdata ?? "";
    const storedCallbackState = getStoredInicisCallbackState(
      submissionPayment?.raw_response ?? karaokePayment?.raw_response ?? null,
    );
    const callbackStateVerified = verifyInicisCallbackState({
      storedState: storedCallbackState,
      receivedState: receivedCallbackState,
    });
    const buildVerifiedGuestBridgeRedirect = (
      payload: BridgePayload,
      approvalSignatureVerified: boolean,
    ) => {
      const response = buildBridgeRedirect(baseUrl, payload);
      if (
        !callbackStateVerified ||
        !approvalSignatureVerified ||
        !submissionId ||
        !orderId ||
        !guestToken
      ) {
        return response;
      }

      const grant = createPaymentResultGrant({
        provider: "inicis",
        submissionId,
        orderId,
        guestToken,
      });
      if (grant) setPaymentResultGrantCookie(response, grant);
      return response;
    };
    const paymentAmount = submissionPayment
      ? Number(submissionPayment.amount_krw ?? NaN)
      : Number(
          karaokePayment?.amount_krw ??
            karaokePayment?.request?.amount_krw ??
            NaN,
        );
    const alreadyApproved =
      submissionPayment?.status === "APPROVED" ||
      karaokePayment?.status === "APPROVED";
    if (alreadyApproved && (!resultCode || isInicisSuccessCode(resultCode))) {
      return buildBridgeRedirect(baseUrl, {
        status: "SUCCESS",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        tid: tidFromReturn || null,
        amount:
          Number.isFinite(amountFromReturn) && amountFromReturn > 0
            ? amountFromReturn
            : null,
        resultCode: resultCode || "0000",
        message: "이미 승인 처리된 결제입니다.",
      });
    }

    const paymentStatus = submissionPayment?.status ?? karaokePayment?.status ?? null;
    if (paymentStatus && !canHandlePaymentApprovalCallback(paymentStatus)) {
      console.warn("[INICIS][callback_rejected] terminal payment state", {
        orderId,
        paymentStatus,
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "취소되거나 종료된 결제 요청입니다. 새로 결제를 시작해주세요.",
        resultCode: "PAYMENT_TERMINAL_STATE",
      });
    }

    const saveFailure = async (code: string, message: string, raw?: Record<string, unknown>) => {
      if (!callbackStateVerified) {
        console.warn("[INICIS][failure_not_persisted] callback state mismatch", {
          orderId,
          code,
          hasStoredState: Boolean(storedCallbackState),
          hasReceivedState: Boolean(receivedCallbackState),
        });
        return;
      }
      const scrubbed = scrubInicisPaymentAudit(raw ?? params);
      if (submissionId) {
        await markPaymentFailure(orderId, {
          result_code: code,
          result_message: message,
          raw_response: scrubbed,
        });
      }
      if (karaokeRequestId) {
        await markKaraokePaymentFailure(orderId, {
          result_code: code,
          result_message: message,
          raw_response: scrubbed,
          callback_state: receivedCallbackState,
        });
      }
    };

    if ((!submissionPayment && !karaokePayment) || paymentError) {
      console.info("[INICIS][final]", {
        orderId,
        status: "FAILED",
        reason: "payment_not_found_before_approval",
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 내역을 찾을 수 없습니다.",
        resultCode: "ORDER_NOT_FOUND",
      });
    }

    if (
      Number.isFinite(paymentAmount) &&
      paymentAmount > 0 &&
      Number.isFinite(amountFromReturn) &&
      amountFromReturn > 0 &&
      paymentAmount !== amountFromReturn
    ) {
      await saveFailure(
        "PRICE_MISMATCH",
        `금액 불일치 (${amountFromReturn} != ${paymentAmount})`,
        {
          returnParams: scrubParams(params),
          phase: "pre_auth",
          expected: paymentAmount,
          received: amountFromReturn,
        },
      );
      console.info("[INICIS][final]", {
        orderId,
        status: "FAILED",
        reason: "price_mismatch_before_approval",
        expected: paymentAmount,
        received: amountFromReturn,
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 금액이 일치하지 않습니다.",
        resultCode: "PRICE_MISMATCH",
      });
    }

    if (!approvalUrl || !isTrustedInicisUrl(approvalUrl)) {
      await saveFailure(
        "INVALID_AUTH_URL",
        "승인 URL을 검증할 수 없습니다.",
        { returnParams: scrubParams(params), approvalUrl },
      );
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 승인 경로가 유효하지 않습니다.",
        resultCode: "INVALID_AUTH_URL",
      });
    }

    if (netCancelUrl && !isTrustedInicisUrl(netCancelUrl)) {
      await saveFailure(
        "INVALID_NETCANCEL_URL",
        "망취소 URL을 검증할 수 없습니다.",
        { returnParams: scrubParams(params), netCancelUrl },
      );
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 취소 경로가 유효하지 않습니다.",
        resultCode: "INVALID_NETCANCEL_URL",
      });
    }

    if (mid && mid !== config.mid) {
      await saveFailure("MID_MISMATCH", "MID 불일치");
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "MID 불일치",
        resultCode: "MID_MISMATCH",
      });
    }

    if (cancelFlag) {
      await saveFailure(resultCode || "CANCEL", resultMsg || "사용자 취소");
      return buildBridgeRedirect(baseUrl, {
        status: "CANCEL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: resultMsg || "사용자가 결제를 취소했습니다.",
        resultCode: resultCode || "CANCEL",
      });
    }

    if (!orderId) {
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        message: "주문번호를 확인할 수 없습니다.",
        resultCode: resultCode || "NO_ORDER_ID",
      });
    }

    if (resultCode && !isInicisSuccessCode(resultCode)) {
      await saveFailure(resultCode, resultMsg || "결제 인증에 실패했습니다.");
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: resultMsg || "결제가 완료되지 않았습니다.",
        resultCode,
      });
    }

    if (!authToken) {
      await saveFailure(resultCode || "AUTH_MISSING", resultMsg || "인증 토큰을 받지 못했습니다.");
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: resultMsg || "결제 인증이 완료되지 않았습니다.",
        resultCode: resultCode || "AUTH_MISSING",
      });
    }

    console.info("[INICIS][auth_call_start]", {
      env: envSuffix,
      orderId,
      approvalHost,
      hasTstamp: Boolean(params.tstamp ?? params.timestamp),
      tstamp: params.tstamp ?? params.timestamp ?? null,
      moid: orderId,
      totPrice: amountFromReturn || null,
      timestamp,
      hasNetCancelUrl: Boolean(netCancelUrl),
    });

    const approval = await requestStdPayApproval({
      authUrl: approvalUrl,
      netCancelUrl,
      authToken,
      timestamp,
      skipNetCancel: String(process.env.INICIS_DEBUG_NO_CANCEL ?? "").toLowerCase() === "true",
    });

    const compensateApprovedGateway = async (reason: string) => {
      if (
        String(process.env.INICIS_DEBUG_NO_CANCEL ?? "").toLowerCase() ===
        "true"
      ) {
        console.warn("[INICIS][net_cancel] skipped by debug setting", {
          orderId,
          reason,
        });
        return { ok: false, data: null, skipped: true };
      }
      const cancellation = await requestStdPayNetCancel({
        netCancelUrl,
        authToken,
        timestamp,
      });
      const safeCancellation = scrubInicisPaymentAudit({
        ok: cancellation.ok,
        data: cancellation.data,
      });
      if (!cancellation.ok) {
        console.error("[INICIS][net_cancel] compensation failed", {
          orderId,
          reason,
          audit: safeCancellation,
          error:
            cancellation.error instanceof Error
              ? cancellation.error.message.slice(0, 200)
              : "unknown",
        });
      }
      return {
        ok: cancellation.ok,
        data: safeCancellation,
        skipped: false,
      };
    };

    const authData =
      approval.data as Record<string, string | number | null | undefined> | null;
    const authResultCode = toCode(
      authData?.resultCode ?? authData?.resultcode,
      "AUTH_FAIL",
    );
    const authResultMsg =
      authData?.resultMsg ??
      authData?.resultmsg ??
      (approval.ok ? "승인 완료" : "승인 실패");

    console.info("[INICIS][auth_call_done]", {
      env: envSuffix,
      orderId,
      authResultCode,
      authResultMsg: authResultMsg ? String(authResultMsg).slice(0, 120) : null,
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
      authKeys: authData ? Object.keys(authData) : [],
      tid: tidFromReturn ? mask(tidFromReturn) : null,
      authSignatureExists: Boolean(
        (authData?.authSignature as string | null | undefined) ??
          (authData?.AuthSignature as string | null | undefined) ??
          null,
      ),
    });

    // Signature verification for STDPay approval response (secureSignature check).
    const tstampForSig =
      authData?.tstamp ??
      authData?.timestamp ??
      params.tstamp ??
      params.timestamp ??
      timestamp;
    const moidForSig =
      (authData?.MOID as string | null | undefined) ??
      params.MOID ??
      params.oid ??
      params.orderId ??
      orderId;
    const normalizePrice = (value: string | number | null | undefined) => {
      if (value == null) return "";
      const str = String(value).replace(/,/g, "").trim();
      return str;
    };
    const priceSources = [
      { value: authData?.TotPrice, source: "auth.TotPrice" },
      { value: authData?.price, source: "auth.price" },
    ];
    let totPriceForSig = "";
    let totPriceSource = "unknown";
    for (const candidate of priceSources) {
      const normalized = normalizePrice(candidate.value);
      if (normalized) {
        totPriceForSig = normalized;
        totPriceSource = candidate.source;
        break;
      }
    }
    const authSignature =
      (authData?.authSignature as string | null | undefined) ??
      (authData?.AuthSignature as string | null | undefined) ??
      null;
    const mKeyForSig = sha256(config.signKey ?? "");
    const ourSecureSignature = makeAuthSecureSignature({
      mid: config.mid,
      tstamp: tstampForSig ?? "",
      MOID: moidForSig,
      TotPrice: totPriceForSig,
      mKey: mKeyForSig,
      signKey: config.signKey,
    });
    const hasSigInputs =
      Boolean(authSignature) &&
      Boolean(totPriceForSig) &&
      Boolean(moidForSig) &&
      Boolean(tstampForSig);
    const localSigMatch =
      hasSigInputs && authSignature && ourSecureSignature
        ? authSignature === ourSecureSignature
        : null;
    const verifyStatus =
      localSigMatch === true
        ? "verified"
        : hasSigInputs
          ? "failed"
          : "unknown";
    const sigMismatchReason = !hasSigInputs
      ? !authSignature
        ? "missing_auth_signature"
        : !totPriceForSig
          ? "missing_totprice"
          : !moidForSig
            ? "missing_moid"
            : !tstampForSig
              ? "missing_tstamp"
              : "missing_input"
      : localSigMatch
        ? null
        : "sig_mismatch";

    console.info("[INICIS][signature_verify]", {
      match: localSigMatch === true,
      reason: sigMismatchReason,
      midMasked: mask(config.mid),
      tstamp: tstampForSig ?? null,
      MOID: moidForSig,
      TotPrice: totPriceForSig,
      totPriceSource,
      authSignaturePresent: Boolean(authSignature),
      approvalKeys: authData ? Object.keys(authData) : [],
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
      verifyStatus,
    });

    if (hasSigInputs && localSigMatch === false) {
      const cancellation =
        approval.ok && isInicisSuccessCode(authResultCode)
          ? await compensateApprovedGateway("signature_mismatch")
          : null;
      await saveFailure("SIGNATURE_MISMATCH", "서명 검증에 실패했습니다.", {
        returnParams: scrubParams(params),
        approval: authData,
        signature: {
          verifyStatus,
          sigMismatchReason,
        },
        compensation: cancellation,
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 서명 검증에 실패했습니다.",
        resultCode: "SIGNATURE_MISMATCH",
      });
    }

    const authSuccess = isInicisSuccessCode(authResultCode);
    const tid =
      toStrOrNull(
        authData?.P_TID ??
          authData?.tid ??
          authData?.TID ??
          authData?.CARD_TID ??
          tidFromReturn ??
          null,
      ) ?? null;
    const shouldSucceed = approval.ok && authSuccess && Boolean(tid);

    if (!authData || !shouldSucceed) {
      const failMessage =
        !authSuccess
          ? String(authResultMsg ?? "승인 요청에 실패했습니다.")
          : "결제 정보를 확인할 수 없습니다.";

      const cancellation =
        approval.ok && authSuccess
          ? await compensateApprovedGateway("approval_response_incomplete")
          : null;
      await saveFailure(authResultCode, failMessage, {
        returnParams: scrubParams(params),
        approval: authData,
        compensation: cancellation,
      });

      console.info("[INICIS][final]", {
        orderId,
        status: "FAILED",
        reason:
          !authSuccess
            ? "auth_fail"
            : !authData
              ? "auth_missing"
              : "auth_unknown",
        resultCode: authResultCode,
      });

      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: failMessage,
        resultCode: authResultCode,
      });
    }

    const approvedOrderId = toStrOrNull(
      authData.MOID ??
        authData.moid ??
        authData.orderNumber ??
        authData.orderid ??
        null,
    );
    const totPrice = normalizeAmount(authData.TotPrice ?? authData.price ?? null);
    const bindingError = validateGatewayPaymentBinding({
      expectedOrderId: orderId,
      approvedOrderId,
      expectedAmount: paymentAmount,
      approvedAmount: totPrice,
    });
    if (bindingError) {
      const cancellation = await compensateApprovedGateway(bindingError);
      const isOrderError = bindingError.startsWith("ORDER_ID_");
      const code = isOrderError ? "ORDER_MISMATCH" : "PRICE_MISMATCH";
      const message = isOrderError
        ? "승인된 주문번호가 결제 요청과 일치하지 않습니다."
        : "승인된 결제 금액이 결제 요청과 일치하지 않습니다.";
      await saveFailure(code, message, {
        returnParams: scrubParams(params),
        approval: authData,
        bindingError,
        expectedOrderId: orderId,
        approvedOrderId,
        expectedAmount: paymentAmount,
        approvedAmount: Number.isFinite(totPrice) ? totPrice : null,
        compensation: cancellation,
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message,
        resultCode: code,
      });
    }

    if ((!submissionPayment && !karaokePayment) || paymentError) {
      console.info("[INICIS][final]", {
        orderId,
        status: "FAILED",
        reason: "payment_not_found",
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 내역을 찾을 수 없습니다.",
        resultCode: "ORDER_NOT_FOUND",
      });
    }

    if (
      Number.isFinite(paymentAmount) &&
      paymentAmount > 0 &&
      totPrice > 0 &&
      paymentAmount !== totPrice
    ) {
      await saveFailure("PRICE_MISMATCH", `금액 불일치 (${totPrice} != ${paymentAmount})`, {
        returnParams: scrubParams(params),
        approval: authData,
      });
      console.info("[INICIS][final]", {
        orderId,
        status: "FAILED",
        reason: "price_mismatch",
        totPrice,
        expected: paymentAmount,
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        requestId: karaokeRequestId,
        message: "결제 금액이 일치하지 않습니다.",
        resultCode: "PRICE_MISMATCH",
      });
    }

    console.info("[INICIS][signature_verify]", {
      orderId,
      tid: tid ? mask(tid) : null,
      resultCode: toCode(authData.resultCode, "0000"),
      totPrice,
      mid: mask(config.mid),
      tstamp: tstampForSig ?? null,
      moid: moidForSig,
      secureSignatureMatches: localSigMatch === true,
      verifyStatus,
      sigMismatchReason,
    });

    const successPayload = {
      amount_krw: totPrice,
      tid,
      result_code: toCode(authData.resultCode, "0000"),
      result_message: String(authResultMsg ?? "결제 완료"),
      raw_response: scrubInicisPaymentAudit({
        returnParams: scrubParams(params),
        approval: authData,
        signatureVerification: {
          sigVerified: localSigMatch === true,
          verifyStatus,
          sigMismatchReason,
          inputs: {
            mid: mask(config.mid),
            tstamp: tstampForSig ?? null,
            MOID: moidForSig,
            TotPrice: totPriceForSig || null,
            totPriceSource,
          },
        },
      }),
    };

    const submissionSuccess = submissionId
      ? await markPaymentSuccess(orderId, successPayload)
      : { ok: true, error: null, submissionId: null };
    const karaokeSuccess = karaokeRequestId
      ? await markKaraokePaymentSuccess(orderId, successPayload)
      : { ok: true, error: null, requestId: null };

    const persistFailed =
      (submissionId && !submissionSuccess.ok) ||
      (karaokeRequestId && !karaokeSuccess.ok);
    if (persistFailed) {
      const cancellation = await compensateApprovedGateway("persist_failed");
      await saveFailure(
        "PERSIST_FAIL",
        cancellation.ok
          ? "승인 후 저장 실패로 망취소 처리되었습니다."
          : "승인 후 저장 및 망취소 처리에 실패했습니다.",
        {
          returnParams: scrubParams(params),
          approval: authData,
          compensation: cancellation,
        },
      );
      console.error("[INICIS][persist][error]", {
        orderId,
        submissionId,
        karaokeRequestId,
        submissionError: submissionSuccess.error ?? null,
        karaokeError: karaokeSuccess.error ?? null,
        compensation: cancellation,
      });
      return buildVerifiedGuestBridgeRedirect(
        {
          status: "FAIL",
          orderId,
          submissionId,
          requestId: karaokeRequestId,
          tid,
          amount: totPrice,
          resultCode: "PERSIST_FAIL",
          message: "결제 승인 후 저장 처리에 실패했습니다. 고객센터로 문의해주세요.",
        },
        approval.ok && localSigMatch === true,
      );
    }

    console.info("[INICIS][final]", {
      orderId,
      status: "APPROVED",
      resultCode: toCode(authData.resultCode, "0000"),
      secureSignatureMatches: localSigMatch === true,
      sigVerified: localSigMatch === true,
      sigMismatchReason,
      verifyStatus,
    });

    return buildVerifiedGuestBridgeRedirect(
      {
        status: "SUCCESS",
        orderId,
        submissionId,
        submissionIds: paidSubmissionIds,
        requestId: karaokeSuccess.requestId ?? karaokeRequestId,
        tid,
        amount: totPrice,
        resultCode: toCode(authData.resultCode, "0000"),
        message: String(authResultMsg ?? "결제가 완료되었습니다."),
      },
      approval.ok && localSigMatch === true,
    );
  } catch (error) {
    if (error instanceof InicisCallbackPayloadError) {
      return NextResponse.json(
        { error: "Invalid Inicis callback payload." },
        { status: error.status },
      );
    }
    console.error("[INICIS][final][error]", error);
    const fallbackBase = parsed?.baseUrl ?? getBaseUrl();
    return buildBridgeRedirect(fallbackBase, {
      status: "ERROR",
      message: "결제 처리 중 오류가 발생했습니다.",
    });
  }
}
