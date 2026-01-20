import { NextRequest, NextResponse } from "next/server";

import { requestStdPayApproval } from "@/lib/inicis/api";
import { getStdPayConfig } from "@/lib/inicis/config";
import {
  getInicisTimestamp,
  makeAuthRequestSignature,
  makeAuthSecureSignature,
  sha256,
} from "@/lib/inicis/crypto";
import {
  getPaymentByOrderId,
  markPaymentFailure,
  markPaymentSuccess,
} from "@/lib/payments/submission";
import { getBaseUrl } from "@/lib/url";
import { isInicisSuccessCode } from "@/lib/inicis/api";

type ReturnStatus = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

type BridgePayload = {
  status: ReturnStatus;
  orderId?: string | null;
  submissionId?: string | null;
  guestToken?: string | null;
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
  if (payload.message) url.searchParams.set("message", payload.message);
  if (payload.resultCode) url.searchParams.set("resultCode", payload.resultCode);
  if (payload.tid) url.searchParams.set("tid", payload.tid);
  if (payload.amount != null && Number.isFinite(payload.amount)) {
    url.searchParams.set("amount", String(payload.amount));
  }
  return NextResponse.redirect(url.toString(), 303);
};

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
      console.warn("[Inicis][STDPay][return] formData parse error", error);
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
    const authUrl =
      params.checkAckUrl ??
      params.checkAckURL ??
      params.authUrl ??
      params.auth_url ??
      params.authurl ??
      "";
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
    const timestamp = String(
      params.tstamp ?? params.timestamp ?? getInicisTimestamp(),
    );

    const pick = (k: string) => (typeof params[k] === "string" ? String(params[k]) : "");
    const mask = (v: string | null | undefined, head = 4, tail = 2) => {
      if (!v) return "";
      if (v.length <= head + tail) return `${v[0] ?? ""}*`;
      return `${v.slice(0, head)}***${v.slice(-tail)}`;
    };

    const config = getStdPayConfig();
    const mKey = sha256(config.signKey ?? "");
    const envSuffix = config.env === "prod" ? "PROD" : "STG";

    console.info("[Inicis][STDPay][return]", {
      step: "callback_received",
      method,
      contentType,
      orderId,
      resultCode,
      hasAuthToken: Boolean(authToken),
      hasAuthUrl: Boolean(authUrl),
      netCancelUrl: Boolean(netCancelUrl),
      tid: tidFromReturn ? mask(tidFromReturn) : null,
      mid: mid ? mask(mid) : null,
      tstamp: pick("tstamp") || null,
      totPrice: amountFromReturn || null,
      keys,
      env: envSuffix,
      midConfig: mask(config.mid),
      stdJsUrl: config.stdJsUrl,
      signKeyLen: config.signKey?.length ?? 0,
      signKeyTrimmedLen: config.signKey?.trim().length ?? 0,
      mKeyPrefix: mKey.slice(0, 6),
    });

    const { payment, error: paymentError } = orderId
      ? await getPaymentByOrderId(orderId)
      : { payment: null, error: null };
    const submissionId = payment?.submission?.id ?? null;
    const guestToken = payment?.submission?.guest_token ?? null;
    const paymentAmount = Number(payment?.amount_krw ?? NaN);

    if (mid && mid !== config.mid) {
      if (payment?.submission) {
        const save = await markPaymentFailure(orderId, {
          result_code: "MID_MISMATCH",
          result_message: "MID 불일치",
          raw_response: scrubParams(params),
        });
        console.info("[Inicis][STDPay][return]", {
          step: "db_write",
          orderId,
          status: "FAILED",
          ok: save.ok,
        });
      }
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
        message: "MID 불일치",
        resultCode: "MID_MISMATCH",
      });
    }

    if (cancelFlag) {
      if (payment?.submission) {
        await markPaymentFailure(orderId, {
          result_code: resultCode || "CANCEL",
          result_message: resultMsg || "사용자 취소",
          raw_response: scrubParams(params),
        });
      }
      return buildBridgeRedirect(baseUrl, {
        status: "CANCEL",
        orderId,
        submissionId,
        guestToken,
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
      if (payment?.submission) {
        await markPaymentFailure(orderId, {
          result_code: resultCode,
          result_message: resultMsg || "결제 인증에 실패했습니다.",
          raw_response: scrubParams(params),
        });
      }
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
        message: resultMsg || "결제가 완료되지 않았습니다.",
        resultCode,
      });
    }

    if (!authToken || !authUrl) {
      if (payment?.submission) {
        await markPaymentFailure(orderId, {
          result_code: resultCode || "AUTH_MISSING",
          result_message: resultMsg || "인증 토큰을 받지 못했습니다.",
          raw_response: scrubParams(params),
        });
      }
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
        message: resultMsg || "결제 인증이 완료되지 않았습니다.",
        resultCode: resultCode || "AUTH_MISSING",
      });
    }

    console.info("[Inicis][STDPay][return]", {
      step: "auth_call_start",
      orderId,
      authHost: authUrl
        ? (() => {
            try {
              const u = new URL(authUrl);
              return `${u.host}${u.pathname}`;
            } catch {
              return null;
            }
          })()
        : null,
      hasTstamp: Boolean(params.tstamp ?? params.timestamp),
      tstamp: params.tstamp ?? params.timestamp ?? null,
      moid: orderId,
      totPrice: amountFromReturn || null,
      timestamp,
      hasNetCancelUrl: Boolean(netCancelUrl),
    });

    const approval = await requestStdPayApproval({
      authUrl,
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

    console.info("[Inicis][STDPay][return]", {
      step: "auth_call_done",
      orderId,
      authResultCode,
      authResultMsg: authResultMsg ? String(authResultMsg).slice(0, 120) : null,
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
      authKeys: authData ? Object.keys(authData) : [],
    });

    const maskSig = (v: string | null | undefined) =>
      !v ? null : v.length <= 10 ? `${v[0] ?? ""}*` : `${v.slice(0, 6)}***${v.slice(-4)}`;
    const tstampForSig =
      authData?.tstamp ??
      authData?.timestamp ??
      params.tstamp ??
      params.timestamp ??
      timestamp;
    const moidForSig = orderId;
    const normalizePrice = (value: string | number | null | undefined) => {
      if (value == null) return "";
      const str = String(value).replace(/,/g, "").trim();
      return str;
    };
    const priceSources = [
      { value: authData?.TotPrice, source: "auth.TotPrice" },
      { value: authData?.price, source: "auth.price" },
      { value: params.TotPrice, source: "params.TotPrice" },
      { value: params.price, source: "params.price" },
      { value: params.P_AMT, source: "params.P_AMT" },
      { value: amountFromReturn, source: "amountFromReturn" },
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
    const localSigMatch =
      authSignature && ourSecureSignature
        ? authSignature === ourSecureSignature
        : approval.secureSignatureMatches === true;

    if (!totPriceForSig) {
      console.info("[INICIS][signature_verify]", {
        match: false,
        reason: "missing_totprice",
        midMasked: mask(config.mid),
        tstamp: tstampForSig ?? null,
        MOID: moidForSig,
        TotPrice: totPriceForSig || null,
        priceSource: totPriceSource,
        authKeys: authData ? Object.keys(authData) : [],
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
        message: "결제 금액을 확인할 수 없습니다.",
        resultCode: "SIG_PRICE_MISSING",
      });
    }

    console.info("[INICIS][signature_verify]", {
      match: localSigMatch === true,
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
    });

    if (
      !approval.ok ||
      !authData ||
      !localSigMatch ||
      !isInicisSuccessCode(authResultCode)
    ) {
      const failMessage =
        !localSigMatch
          ? "결제 서명 검증에 실패했습니다."
          : String(authResultMsg ?? "승인 요청에 실패했습니다.");

      if (payment?.submission) {
        await markPaymentFailure(orderId, {
          result_code: authResultCode,
          result_message: failMessage,
          raw_response: {
            returnParams: scrubParams(params),
            approval: authData,
          },
        });
      }

      console.info("[Inicis][STDPay][return]", {
        step: "final",
        orderId,
        status: "FAILED",
        reason:
          !localSigMatch
            ? "sig_mismatch"
            : !isInicisSuccessCode(authResultCode)
              ? "auth_fail"
              : "auth_unknown",
        resultCode: authResultCode,
      });

      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
        submissionId,
        guestToken,
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
    const tid =
      toStrOrNull(
        authData.P_TID ??
          authData.tid ??
          authData.TID ??
          authData.CARD_TID ??
          tidFromReturn ??
          null,
      ) ?? null;

    if (!payment?.submission || paymentError) {
      console.info("[Inicis][STDPay][return]", {
        step: "final",
        orderId,
        status: "FAILED",
        reason: "payment_not_found",
      });
      return buildBridgeRedirect(baseUrl, {
        status: "FAIL",
        orderId,
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
      await markPaymentFailure(orderId, {
        result_code: "PRICE_MISMATCH",
        result_message: `금액 불일치 (${totPrice} != ${paymentAmount})`,
        raw_response: {
          returnParams: scrubParams(params),
          approval: authData,
        },
      });
      console.info("[Inicis][STDPay][return]", {
        step: "final",
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
        message: "결제 금액이 일치하지 않습니다.",
        resultCode: "PRICE_MISMATCH",
      });
    }

    console.info("[Inicis][STDPay][return]", {
      step: "signature_verify",
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
    });

    await markPaymentSuccess(orderId, {
      tid,
      result_code: toCode(authData.resultCode, "0000"),
      result_message: String(authResultMsg ?? "결제 완료"),
      raw_response: {
        returnParams: scrubParams(params),
        approval: authData,
      },
    });

    console.info("[Inicis][STDPay][return]", {
      step: "final",
      orderId,
      status: "APPROVED",
      resultCode: toCode(authData.resultCode, "0000"),
      secureSignatureMatches: localSigMatch === true,
    });

    return buildBridgeRedirect(baseUrl, {
      status: "SUCCESS",
      orderId,
      submissionId,
      guestToken,
      tid,
      amount: totPrice,
      resultCode: toCode(authData.resultCode, "0000"),
      message: String(authResultMsg ?? "결제가 완료되었습니다."),
    });
  } catch (error) {
    console.error("[Inicis][STDPay][return][error]", error);
    const fallbackBase = parsed?.baseUrl ?? getBaseUrl();
    return buildBridgeRedirect(fallbackBase, {
      status: "ERROR",
      message: "결제 처리 중 오류가 발생했습니다.",
    });
  }
}
