import { NextRequest, NextResponse } from "next/server";

import { requestStdPayApproval } from "@/lib/inicis/api";
import { getStdPayConfig } from "@/lib/inicis/config";
import {
  getInicisTimestamp,
  makeAuthSecureSignature,
  sha256,
} from "@/lib/inicis/crypto";
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
import { getBaseUrl } from "@/lib/url";
import { isInicisSuccessCode } from "@/lib/inicis/api";

type ReturnStatus = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

type BridgePayload = {
  status: ReturnStatus;
  orderId?: string | null;
  submissionId?: string | null;
  guestToken?: string | null;
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

const mask = (value: string | null | undefined, visible = 2) => {
  if (!value) return "";
  if (value.length <= visible) return `${value[0] ?? ""}*`;
  const head = value.slice(0, visible);
  const tail = value.slice(-visible);
  return `${head}${"*".repeat(Math.max(1, value.length - visible * 2))}${tail}`;
};

const scrubParams = (params: Record<string, string>) => {
  const sanitized = { ...params };
  [
    "authToken",
    "auth_token",
    "authtoken",
    "authUrl",
    "auth_url",
    "authurl",
    "netCancelUrl",
    "netCancelURL",
    "netcancelurl",
    "signature",
  ].forEach((key) => {
    if (sanitized[key]) sanitized[key] = "[masked]";
  });
  return sanitized;
};

const buildBridgeRedirect = (baseUrl: string, payload: BridgePayload) => {
  const url = new URL("/pay/inicis/return", baseUrl);
  url.searchParams.set("status", payload.status);
  if (payload.orderId) url.searchParams.set("orderId", payload.orderId);
  if (payload.submissionId) url.searchParams.set("submissionId", payload.submissionId);
  if (payload.guestToken) url.searchParams.set("guestToken", payload.guestToken);
  if (payload.requestId) url.searchParams.set("requestId", payload.requestId);
  if (payload.message) url.searchParams.set("message", payload.message);
  if (payload.resultCode) url.searchParams.set("resultCode", payload.resultCode);
  if (payload.tid) url.searchParams.set("tid", payload.tid);
  if (payload.amount != null && Number.isFinite(payload.amount)) {
    url.searchParams.set("amount", String(payload.amount));
  }
  return NextResponse.redirect(url.toString(), 303);
};

// Parses STDPay callback payloads (form POST or query) for downstream approval handling.
const parseParams = async (req: NextRequest): Promise<ParsedReturn> => {
  const baseUrl = getBaseUrl(req);
  const contentType = req.headers.get("content-type") ?? "";
  const method = req.method;
  let params: Record<string, string> = {};
  let keys: string[] = [];

  if (method === "POST") {
    try {
      const form = await req.formData();
      keys = Array.from(form.keys());
      params = Object.fromEntries(
        Array.from(form.entries()).map(([k, v]) => [k, String(v)]),
      );
    } catch (error) {
      console.warn("[INICIS][callback_received] formData parse error", error);
    }
  }

  if (!Object.keys(params).length) {
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    params = queryParams;
    keys = Object.keys(queryParams);
  } else {
    // Merge in query params without overriding POSTed values
    const url = new URL(req.url);
    url.searchParams.forEach((value, key) => {
      if (!(key in params)) params[key] = value;
      if (!keys.includes(key)) keys.push(key);
    });
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

    const orderId =
      params.orderNumber ?? params.oid ?? params.orderid ?? params.MOID ?? "";
    const mid = params.mid ?? "";
    const authToken =
      params.authToken ?? params.auth_token ?? params.authtoken ?? "";
    const authUrlFromReturn =
      params.authUrl ?? params.auth_url ?? params.authurl ?? "";
    const checkAckUrl = params.checkAckUrl ?? params.checkAckURL ?? "";
    const approvalUrl =
      authUrlFromReturn ||
      checkAckUrl ||
      "";
    // FIX: use authUrl instead of checkAckUrl for approval (2026-01-21)
    const netCancelUrl =
      params.netCancelUrl ??
      params.netCancelURL ??
      params.netcancelurl ??
      params.NetCancelURL ??
      "";
    const resultCode =
      params.resultCode ?? params.resultcode ?? params.P_STATUS ?? "";
    const resultMsg =
      params.resultMsg ?? params.resultmsg ?? params.P_RMESG1 ?? "";
    const cancelFlag = params.cancel === "1" || params.cancel === "true";
    const tidFromReturn =
      params.tid ??
      params.TID ??
      params.P_TID ??
      params.PG_TID ??
      params.CARD_TID ??
      "";
    const amountFromReturn = Number(
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
    const mKey = sha256(config.signKey ?? "");
    const envSuffix = config.env === "prod" ? "PROD" : "STG";
    const looksHashedKey = /^[0-9a-fA-F]{64}$/.test(config.signKey ?? "");

    if (looksHashedKey) {
      console.warn("[INICIS][warn] signKey_looks_like_hashed_key", {
        env: envSuffix,
        signKeyLen: config.signKey?.length ?? 0,
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
      signKeyLen: config.signKey?.length ?? 0,
      signKeyTrimmedLen: config.signKey?.trim().length ?? 0,
      mKeyPrefix: mKey.slice(0, 6),
      approvalHost,
    });

    const { payment: submissionPayment, error: paymentError } = orderId
      ? await getPaymentByOrderId(orderId)
      : { payment: null, error: null };
    const { payment: karaokePayment } = orderId && !submissionPayment ? await getKaraokePaymentByOrderId(orderId) : { payment: null };
    const submissionId = submissionPayment?.submission?.id ?? null;
    const guestToken = submissionPayment?.submission?.guest_token ?? null;
    const karaokeRequestId = karaokePayment?.request?.id ?? null;
    const paymentAmount = submissionPayment
      ? Number(submissionPayment.amount_krw ?? NaN)
      : Number(
          karaokePayment?.amount_krw ??
            karaokePayment?.request?.amount_krw ??
            NaN,
        );

    const saveFailure = async (code: string, message: string, raw?: Record<string, unknown>) => {
      const scrubbed = raw ?? scrubParams(params);
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
        });
      }
    };

    if (mid && mid !== config.mid) {
      await saveFailure("MID_MISMATCH", "MID 불일치");
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
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
        guestToken,
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
        guestToken,
        requestId: karaokeRequestId,
        message: resultMsg || "결제가 완료되지 않았습니다.",
        resultCode,
      });
    }

    if (!authToken || !approvalUrl) {
      if (!approvalUrl) {
        console.error("[INICIS][error] missing approvalUrl", {
          orderId,
          hasAuthToken: Boolean(authToken),
          hasAuthUrl: Boolean(authUrlFromReturn),
          hasCheckAckUrl: Boolean(checkAckUrl),
          parsedKeys: keys,
        });
      }
      await saveFailure(resultCode || "AUTH_MISSING", resultMsg || "인증 토큰을 받지 못했습니다.");
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
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
      signKeyLen: config.signKey?.length ?? 0,
      signKeyTrimmedLen: config.signKey?.trim().length ?? 0,
      mKeyPrefix: mKey.slice(0, 6),
    });

    const approval = await requestStdPayApproval({
      authUrl: approvalUrl,
      netCancelUrl,
      authToken,
      timestamp,
      skipNetCancel: String(process.env.INICIS_DEBUG_NO_CANCEL ?? "").toLowerCase() === "true",
    });

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
      authSignatureLen:
        ((authData?.authSignature as string | null | undefined) ??
          (authData?.AuthSignature as string | null | undefined) ??
          "")?.length ?? 0,
    });

    // Signature verification for STDPay approval response (secureSignature check).
    const maskSig = (v: string | null | undefined) =>
      !v ? null : v.length <= 10 ? `${v[0] ?? ""}*` : `${v.slice(0, 6)}***${v.slice(-4)}`;
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
      ourSig: maskSig(ourSecureSignature),
      authSig: maskSig(authSignature),
      signKeyLen: config.signKey?.length ?? 0,
      signKeyTrimmedLen: config.signKey?.trim().length ?? 0,
      mKeyPrefix: mKeyForSig.slice(0, 6),
      authSigLen: authSignature?.length ?? 0,
      approvalKeys: authData ? Object.keys(authData) : [],
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
      verifyStatus,
    });

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
    const shouldSucceed = authSuccess && Boolean(tid);

    if (!authData || !shouldSucceed) {
      const failMessage =
        !authSuccess
          ? String(authResultMsg ?? "승인 요청에 실패했습니다.")
          : "결제 정보를 확인할 수 없습니다.";

      await saveFailure(authResultCode, failMessage, {
        returnParams: scrubParams(params),
        approval: authData,
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
        guestToken,
        requestId: karaokeRequestId,
        message: failMessage,
        resultCode: authResultCode,
      });
    }

    const totPrice = Number(
      (totPriceForSig && totPriceForSig.length ? totPriceForSig : null) ??
        authData.TotPrice ??
        authData.price ??
        amountFromReturn ??
        0,
    );

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
        guestToken,
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
        guestToken,
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
      authSignature: maskSig(authSignature),
      secureSignature: maskSig(ourSecureSignature),
      verifyStatus,
      sigMismatchReason,
    });

    const successPayload = {
      tid,
      result_code: toCode(authData.resultCode, "0000"),
      result_message: String(authResultMsg ?? "결제 완료"),
      raw_response: {
        returnParams: scrubParams(params),
        approval: authData,
        signatureVerification: {
          sigVerified: localSigMatch === true,
          verifyStatus,
          sigMismatchReason,
          ourSig: maskSig(ourSecureSignature),
          authSig: maskSig(authSignature),
          inputs: {
            mid: mask(config.mid),
            tstamp: tstampForSig ?? null,
            MOID: moidForSig,
            TotPrice: totPriceForSig || null,
            totPriceSource,
          },
        },
      },
    };

    if (submissionId) {
      await markPaymentSuccess(orderId, successPayload);
    }

    const karaokeSuccess = karaokeRequestId
      ? await markKaraokePaymentSuccess(orderId, successPayload)
      : { requestId: null };

    console.info("[INICIS][final]", {
      orderId,
      status: "APPROVED",
      resultCode: toCode(authData.resultCode, "0000"),
      secureSignatureMatches: localSigMatch === true,
      sigVerified: localSigMatch === true,
      sigMismatchReason,
      verifyStatus,
    });

    return buildBridgeRedirect(baseUrl, {
      status: "SUCCESS",
      orderId,
      submissionId,
      guestToken,
      requestId: karaokeSuccess.requestId ?? karaokeRequestId,
      tid,
      amount: totPrice,
      resultCode: toCode(authData.resultCode, "0000"),
      message: String(authResultMsg ?? "결제가 완료되었습니다."),
    });
  } catch (error) {
    console.error("[INICIS][final][error]", error);
    const fallbackBase = parsed?.baseUrl ?? getBaseUrl();
    return buildBridgeRedirect(fallbackBase, {
      status: "ERROR",
      message: "결제 처리 중 오류가 발생했습니다.",
    });
  }
}
