import { NextRequest, NextResponse } from "next/server";

import { getStdPayConfig } from "../../../../../lib/inicis/config";
import { requestStdPayApproval } from "../../../../../lib/inicis/api";
import {
  getPaymentByOrderId,
  markPaymentFailure,
  markPaymentSuccess,
} from "../../../../../lib/payments/submission";
import { getBaseUrl } from "../../../../../lib/url";

const successRedirect = (
  baseUrl: string,
  submissionId: string,
  guestToken?: string | null,
) =>
  guestToken
    ? NextResponse.redirect(
      `${baseUrl}/track/${guestToken}?payment=success&submissionId=${submissionId}`,
    )
    : NextResponse.redirect(
      `${baseUrl}/dashboard/submissions/${submissionId}?payment=success`,
    );

const failureRedirect = (
  baseUrl: string,
  submissionId: string,
  message: string,
  guestToken?: string | null,
) =>
  guestToken
    ? NextResponse.redirect(
      `${baseUrl}/track/${guestToken}?payment=fail&message=${encodeURIComponent(
        message,
      )}&submissionId=${submissionId}`,
    )
    : NextResponse.redirect(
      `${baseUrl}/dashboard/submissions/${submissionId}?payment=fail&message=${encodeURIComponent(
        message,
      )}`,
    );

function maskMid(mid: string) {
  if (!mid) return "";
  if (mid.length <= 4) return `${mid.slice(0, 2)}**`;
  return `${mid.slice(0, 2)}***${mid.slice(-2)}`;
}

/**
 * GET/POST 모두에서 파라미터를 최대한 동일 방식으로 읽어서
 * "콜백이 진짜로 들어오는지", "무슨 키가 오는지"를 1차로 확정한다.
 */
async function readParams(req: NextRequest) {
  const method = req.method;
  const baseUrl = getBaseUrl(req);
  const ct = req.headers.get("content-type") || "";

  // 1) GET: querystring
  if (method === "GET") {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    return { method, baseUrl, contentType: ct, params, formKeys: Object.keys(params) };
  }

  // 2) POST: formData() 우선
  let params: Record<string, string> = {};
  let formKeys: string[] = [];

  try {
    const form = await req.formData();
    formKeys = Array.from(form.keys());
    params = Object.fromEntries(
      Array.from(form.entries()).map(([k, v]) => [k, String(v)]),
    );
  } catch (e) {
    console.warn("[Inicis][STDPay][callback][submission] formData parse error", e);
  }

  return { method, baseUrl, contentType: ct, params, formKeys };
}

async function handler(req: NextRequest) {
  const { method, baseUrl, contentType, params, formKeys } = await readParams(req);

  // ---- 필수 파라미터 후보들 ----
  const authToken = params.authToken ?? "";
  const authUrl = params.authUrl ?? "";
  const netCancelUrl = params.netCancelUrl ?? "";
  const orderId = params.oid ?? params.orderNumber ?? "";
  const mid = params.mid ?? "";
  const timestamp = params.timestamp ?? params.tstamp ?? Date.now().toString();

  const missing = {
    authToken: Boolean(authToken),
    authUrl: Boolean(authUrl),
    oid: Boolean(orderId),
  };

  // 1차 진단 로그: "요청이 들어왔는지/형식이 뭔지/키가 뭔지"가 핵심
  console.warn("[Inicis][STDPay][callback][submission] incoming", {
    method,
    baseUrl,
    contentType,
    hasAuthToken: missing.authToken,
    hasAuthUrl: missing.authUrl,
    hasOrderId: missing.oid,
    mid: mid ? maskMid(mid) : null,
    formKeys,
  });

  const resultCode = params.resultCode ?? "";
  const resultMsg = params.resultMsg ?? "";
  const returnUrl = params.returnUrl ?? "";
  const orderNumber = params.orderNumber ?? params.oid ?? "";

  // GET으로 직접 열거나 / POST가 비정상일 때 여기서 막히는게 정상
  if (!authToken || !authUrl || !orderId) {
    console.warn("[Inicis][STDPay][callback][submission] missing auth fields", {
      method,
      baseUrl,
      contentType,
      resultCode,
      resultMsg,
      orderNumber,
      returnUrl,
      gotKeys: formKeys,
    });

    // 토큰 미발급 등의 실패도 결제 실패로 기록 & 리다이렉트
    if (orderId) {
      const { payment } = await getPaymentByOrderId(orderId);
      if (payment?.submission) {
        const guestToken = payment.submission.guest_token ?? null;
        await markPaymentFailure(orderId, {
          result_code: resultCode || "AUTH_MISSING",
          result_message: resultMsg || "이니시스 인증 토큰을 받지 못했습니다.",
          raw_response: params,
        });
        return failureRedirect(
          baseUrl,
          payment.submission.id,
          resultMsg || "결제 인증이 완료되지 않았습니다.",
          guestToken,
        );
      }
    }

    return NextResponse.json(
      {
        error: "이니시스 인증 실패(토큰 미발급)",
        method,
        baseUrl,
        contentType,
        resultCode,
        resultMsg,
        orderNumber,
        returnUrl,
        missing: [
          !authToken ? "authToken" : null,
          !authUrl ? "authUrl" : null,
          !orderId ? "oid" : null,
        ].filter(Boolean),
        gotKeys: formKeys,
      },
      { status: 400 },
    );
  }

  // ---- MID 검증 ----
  const config = getStdPayConfig();
  if (mid && mid !== config.mid) {
    console.warn("[Inicis][STDPay][callback][submission] MID mismatch", {
      got: maskMid(mid),
      expected: maskMid(config.mid),
    });
    return NextResponse.json({ error: "MID 불일치" }, { status: 400 });
  }

  console.info("[Inicis][STDPay][callback][submission] valid callback", {
    mid: maskMid(config.mid),
    orderId,
    authUrl,
    netCancelUrl: Boolean(netCancelUrl),
    authTokenLen: authToken.length,
    timestamp,
    baseUrl,
  });

  // ---- 결제 내역 찾기 ----
  const { payment } = await getPaymentByOrderId(orderId);
  if (!payment?.submission) {
    return NextResponse.json(
      { error: "결제 내역을 찾을 수 없습니다.", orderId },
      { status: 404 },
    );
  }
  const guestToken = payment.submission.guest_token ?? null;

  // ---- 승인 요청 ----
  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl,
    authToken,
    timestamp: String(timestamp),
  });

  const paymentAmount = Number(payment.amount_krw ?? 0);

  if (!approval.ok || !approval.data) {
    console.warn("[Inicis][STDPay][callback][submission] approval failed", {
      orderId,
      resultCode: approval.data?.resultCode ?? "AUTH_FAIL",
      resultMsg: approval.data?.resultMsg,
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
    });

    await markPaymentFailure(orderId, {
      result_code: approval.data?.resultCode ?? "AUTH_FAIL",
      result_message:
        approval.data?.resultMsg ?? "승인 요청이 실패했습니다. 다시 시도해주세요.",
      raw_response: approval.data ?? null,
    });

    return failureRedirect(
      baseUrl,
      payment.submission.id,
      "결제 승인에 실패했습니다.",
      guestToken,
    );
  }

  // ---- 금액 검증 ----
  const authData = approval.data as Record<string, string | number | null | undefined>;
  const totPrice = Number(authData.TotPrice ?? authData.price ?? 0);

  if (paymentAmount > 0 && totPrice > 0 && paymentAmount !== totPrice) {
    console.warn("[Inicis][STDPay][callback][submission] price mismatch", {
      orderId,
      expected: paymentAmount,
      got: totPrice,
    });

    await markPaymentFailure(orderId, {
      result_code: "PRICE_MISMATCH",
      result_message: `금액 불일치 (${totPrice} != ${paymentAmount})`,
      raw_response: authData,
    });

    return failureRedirect(
      baseUrl,
      payment.submission.id,
      "금액이 일치하지 않습니다.",
      guestToken,
    );
  }

  // ---- 성공 처리 ----
  await markPaymentSuccess(orderId, {
    tid:
      authData.P_TID ??
      authData.tid ??
      authData.TID ??
      authData.CARD_TID ??
      authData.PG_TID ??
      null,
    result_code: authData.resultCode ?? "0000",
    result_message: authData.resultMsg ?? "결제 완료",
    raw_response: authData,
  });

  console.info("[Inicis][STDPay][callback][submission] approval success", {
    orderId,
    tid:
      authData.P_TID ??
      authData.tid ??
      authData.TID ??
      authData.CARD_TID ??
      authData.PG_TID ??
      null,
    resultCode: authData.resultCode ?? "0000",
    totPrice,
  });

  return successRedirect(baseUrl, payment.submission.id, guestToken);
}

export async function POST(req: NextRequest) {
  return handler(req);
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export const runtime = "nodejs";
