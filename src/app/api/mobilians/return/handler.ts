import { NextRequest, NextResponse } from "next/server";

import {
  getKaraokePaymentByOrderId,
  markKaraokePaymentCanceled,
  markKaraokePaymentFailure,
  markKaraokePaymentSuccess,
} from "@/lib/payments/karaoke";
import {
  getPaymentByOrderId,
  markPaymentCanceled,
  markPaymentFailure,
  markPaymentSuccess,
} from "@/lib/payments/submission";
import { getBaseUrl } from "@/lib/url";
import {
  isMobiliansSuccessCode,
  requestMobiliansApproval,
} from "@/lib/mobilians/api";
import { getMobiliansConfig } from "@/lib/mobilians/config";
import {
  makeRegistrationHmac,
  timingSafeEqualString,
} from "@/lib/mobilians/crypto";

type ReturnStatus = "SUCCESS" | "FAIL" | "CANCEL" | "ERROR";

type ParsedReturn = {
  baseUrl: string;
  params: Record<string, string>;
  keys: string[];
  method: string;
  contentType: string;
};

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

const toStr = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const pickRelation = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const normalizeAmount = (value: string | number | null | undefined) => {
  if (value == null) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
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
        Array.from(form.entries()).map(([key, value]) => [key, String(value)]),
      );
    } catch (error) {
      console.warn("[Mobilians][return] formData parse error", error);
    }
  }

  const url = new URL(req.url);
  url.searchParams.forEach((value, key) => {
    if (!(key in params)) params[key] = value;
    if (!keys.includes(key)) keys.push(key);
  });

  return { baseUrl, contentType, method, params, keys };
};

const rawObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getRegistrationRequest = (raw: unknown) => {
  const root = rawObject(raw);
  return rawObject(root.registrationRequest);
};

const buildBridgeRedirect = (baseUrl: string, payload: BridgePayload) => {
  const url = new URL("/pay/mobilians/return", baseUrl);
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

const textResult = (ok: boolean) =>
  new NextResponse(ok ? "SUCCESS" : "FAIL", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

const isHmacRequired = () =>
  String(process.env.MOBILIANS_REQUIRE_HMAC ?? "true").toLowerCase() !== "false";

const verifyHmac = (params: Record<string, string>, raw: unknown) => {
  const incoming = (params.hmac ?? params.HMAC ?? "").trim();
  if (!incoming) return !isHmacRequired();

  const registrationRequest = getRegistrationRequest(raw);
  const amount = params.amount ?? params.AMOUNT ?? "";
  const okUrl = toStr(registrationRequest.ok_url);
  const tradeId = params.trade_id ?? params.tradeId ?? "";
  const timeStamp =
    params.time_stamp ??
    params.timeStamp ??
    toStr(registrationRequest.time_stamp);
  if (!amount || !okUrl || !tradeId || !timeStamp) return !isHmacRequired();

  const expected = makeRegistrationHmac(
    {
      amount,
      okUrl,
      tradeId,
      timeStamp,
    },
    getMobiliansConfig().skey,
  );
  return timingSafeEqualString(incoming, expected);
};

type ProcessResult = BridgePayload & { ok: boolean };

const failResult = (
  payload: Omit<BridgePayload, "status"> & {
    status?: ReturnStatus;
    message: string;
  },
): ProcessResult => ({
  ok: false,
  status: payload.status ?? "FAIL",
  ...payload,
});

const successResult = (payload: Omit<BridgePayload, "status">): ProcessResult => ({
  ok: true,
  status: "SUCCESS",
  ...payload,
});

const processMobiliansReturn = async (
  parsed: ParsedReturn,
): Promise<ProcessResult> => {
  const { params, method, contentType, keys } = parsed;
  const orderId = (
    params.trade_id ??
    params.tradeId ??
    params.orderId ??
    params.oid ??
    ""
  ).trim();
  const tid = (params.tid ?? params.TID ?? "").trim();
  const resultCode = (params.code ?? params.resultCode ?? "").trim();
  const resultMessage = (params.message ?? params.resultMsg ?? "").trim();
  const cashCode = (params.cash_code ?? params.cashCode ?? "CN").trim();
  const payToken = (params.pay_token ?? params.payToken ?? "").trim();
  const productName = (params.product_name ?? params.productName ?? "").trim();
  const amount = normalizeAmount(params.amount ?? params.AMOUNT ?? 0);
  const failFlag = params.fail === "1" || params.cancel === "1";

  console.info("[Mobilians][return][received]", {
    method,
    contentType,
    orderId,
    tid: tid ? `${tid.slice(0, 4)}***` : null,
    resultCode,
    amount,
    keys,
    failFlag,
  });

  if (!orderId) {
    return failResult({
      status: "ERROR",
      message: "주문번호가 없는 결제 응답입니다.",
      resultCode: resultCode || "NO_ORDER_ID",
      tid,
      amount,
    });
  }

  const { payment: submissionPayment } = await getPaymentByOrderId(orderId);
  const { payment: karaokePayment } = submissionPayment
    ? { payment: null }
    : await getKaraokePaymentByOrderId(orderId);
  const payment = submissionPayment ?? karaokePayment;
  const isKaraoke = Boolean(karaokePayment);
  if (!payment) {
    return failResult({
      status: "ERROR",
      orderId,
      message: "결제 요청을 찾을 수 없습니다.",
      resultCode: resultCode || "PAYMENT_NOT_FOUND",
      tid,
      amount,
    });
  }

  const submission = pickRelation(
    (submissionPayment as { submission?: unknown } | null)?.submission as
      | { id?: string; guest_token?: string | null; amount_krw?: number | null }
      | Array<{ id?: string; guest_token?: string | null; amount_krw?: number | null }>
      | null
      | undefined,
  );
  const request = pickRelation(
    (karaokePayment as { request?: unknown } | null)?.request as
      | { id?: string; amount_krw?: number | null }
      | Array<{ id?: string; amount_krw?: number | null }>
      | null
      | undefined,
  );
  const expectedAmount = Math.round(Number(payment.amount_krw ?? 0));
  const commonPayload = {
    orderId,
    submissionId: submission?.id ?? null,
    guestToken: submission?.guest_token ?? null,
    requestId: request?.id ?? null,
    resultCode,
    tid,
    amount,
  };

  if ((payment.status ?? "").toUpperCase() === "APPROVED") {
    return successResult({
      ...commonPayload,
      message: "이미 결제가 완료된 주문입니다.",
    });
  }

  if (failFlag || !isMobiliansSuccessCode(resultCode)) {
    const rawResponse = { provider: "MOBILIANS", auth: params };
    if (failFlag) {
      if (isKaraoke) {
        await markKaraokePaymentCanceled(orderId, {
          result_code: resultCode || "CANCELED",
          result_message: resultMessage || "사용자가 결제를 취소했습니다.",
          raw_response: rawResponse,
        });
      } else {
        await markPaymentCanceled(orderId, {
          result_code: resultCode || "CANCELED",
          result_message: resultMessage || "사용자가 결제를 취소했습니다.",
          raw_response: rawResponse,
        });
      }
      return failResult({
        ...commonPayload,
        status: "CANCEL",
        message: resultMessage || "사용자가 결제를 취소했습니다.",
      });
    }

    if (isKaraoke) {
      await markKaraokePaymentFailure(orderId, {
        result_code: resultCode || "AUTH_FAILED",
        result_message: resultMessage || "모빌리언스 인증에 실패했습니다.",
        raw_response: rawResponse,
      });
    } else {
      await markPaymentFailure(orderId, {
        result_code: resultCode || "AUTH_FAILED",
        result_message: resultMessage || "모빌리언스 인증에 실패했습니다.",
        raw_response: rawResponse,
      });
    }
    return failResult({
      ...commonPayload,
      message: resultMessage || "모빌리언스 인증에 실패했습니다.",
    });
  }

  if (!Number.isFinite(amount) || amount !== expectedAmount) {
    const message = "결제 금액이 주문 금액과 일치하지 않습니다.";
    const rawResponse = { provider: "MOBILIANS", auth: params };
    if (isKaraoke) {
      await markKaraokePaymentFailure(orderId, {
        result_code: "AMOUNT_MISMATCH",
        result_message: message,
        raw_response: rawResponse,
      });
    } else {
      await markPaymentFailure(orderId, {
        result_code: "AMOUNT_MISMATCH",
        result_message: message,
        raw_response: rawResponse,
      });
    }
    return failResult({ ...commonPayload, message, resultCode: "AMOUNT_MISMATCH" });
  }

  if (!verifyHmac(params, payment.raw_response)) {
    const message = "모빌리언스 응답 무결성 검증에 실패했습니다.";
    const rawResponse = { provider: "MOBILIANS", auth: params };
    if (isKaraoke) {
      await markKaraokePaymentFailure(orderId, {
        result_code: "HMAC_MISMATCH",
        result_message: message,
        raw_response: rawResponse,
      });
    } else {
      await markPaymentFailure(orderId, {
        result_code: "HMAC_MISMATCH",
        result_message: message,
        raw_response: rawResponse,
      });
    }
    return failResult({ ...commonPayload, message, resultCode: "HMAC_MISMATCH" });
  }

  if (!tid || !payToken) {
    const message = "모빌리언스 승인에 필요한 값이 누락되었습니다.";
    const rawResponse = { provider: "MOBILIANS", auth: params };
    if (isKaraoke) {
      await markKaraokePaymentFailure(orderId, {
        result_code: "AUTH_VALUE_MISSING",
        result_message: message,
        raw_response: rawResponse,
      });
    } else {
      await markPaymentFailure(orderId, {
        result_code: "AUTH_VALUE_MISSING",
        result_message: message,
        raw_response: rawResponse,
      });
    }
    return failResult({ ...commonPayload, message, resultCode: "AUTH_VALUE_MISSING" });
  }

  const config = getMobiliansConfig();
  const approval = await requestMobiliansApproval({
    sid: config.sid,
    tid,
    cash_code: cashCode || config.cashCode,
    product_name: productName || "온사이드 결제",
    amount: String(amount),
    pay_token: payToken,
  });
  const approvedAmount = normalizeAmount(approval.amount ?? amount);
  const rawResponse = { provider: "MOBILIANS", auth: params, approval };

  if (!isMobiliansSuccessCode(approval.code) || approvedAmount !== expectedAmount) {
    const message =
      approval.message || "모빌리언스 결제 승인에 실패했습니다.";
    if (isKaraoke) {
      await markKaraokePaymentFailure(orderId, {
        result_code: approval.code ?? "APPROVAL_FAILED",
        result_message: message,
        raw_response: rawResponse,
      });
    } else {
      await markPaymentFailure(orderId, {
        result_code: approval.code ?? "APPROVAL_FAILED",
        result_message: message,
        raw_response: rawResponse,
      });
    }
    return failResult({
      ...commonPayload,
      message,
      resultCode: approval.code ?? "APPROVAL_FAILED",
    });
  }

  if (isKaraoke) {
    await markKaraokePaymentSuccess(orderId, {
      tid: approval.tid ?? tid,
      result_code: approval.code ?? "0000",
      result_message: approval.message ?? "정상 처리되었습니다.",
      raw_response: rawResponse,
    });
  } else {
    await markPaymentSuccess(orderId, {
      tid: approval.tid ?? tid,
      result_code: approval.code ?? "0000",
      result_message: approval.message ?? "정상 처리되었습니다.",
      raw_response: rawResponse,
      providerName: "KG모빌리언스",
    });
  }

  return successResult({
    ...commonPayload,
    resultCode: approval.code ?? "0000",
    tid: approval.tid ?? tid,
    message: "결제가 완료되었습니다.",
  });
};

export const handleMobiliansReturn = async (
  req: NextRequest,
  options?: { notificationOnly?: boolean },
) => {
  try {
    const parsed = await parseParams(req);
    const result = await processMobiliansReturn(parsed);
    if (options?.notificationOnly) {
      return textResult(result.ok);
    }
    return buildBridgeRedirect(parsed.baseUrl, result);
  } catch (error) {
    console.error("[Mobilians][return][error]", error);
    if (options?.notificationOnly) {
      return textResult(false);
    }
    const baseUrl = getBaseUrl(req);
    return buildBridgeRedirect(baseUrl, {
      status: "ERROR",
      message: "결제 결과 처리 중 오류가 발생했습니다.",
      resultCode: "HANDLER_ERROR",
    });
  }
};

