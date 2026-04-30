import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureKaraokeRequestOwner,
  findKaraokeRequestById,
} from "@/lib/payments/karaoke";
import { findSubmissionById } from "@/lib/payments/submission";

import { getMobiliansConfig, getMobiliansMode, getMobiliansSiteUrl } from "./config";
import {
  getMobiliansTimestamp,
  makeRegistrationHmac,
} from "./crypto";
import {
  isMobiliansSuccessCode,
  requestMobiliansRegistration,
  type MobiliansRegistrationRequest,
  type MobiliansRegistrationResponse,
} from "./api";

export { ensureKaraokeRequestOwner };

export type MobiliansPayInitResult = {
  provider: "mobilians";
  orderId: string;
  tid: string;
  payUrl: string;
  amount: number;
};

const maskSid = (sid: string) =>
  sid.length <= 4 ? `${sid.slice(0, 2)}**` : `${sid.slice(0, 2)}***${sid.slice(-2)}`;

const compact = (value: string | null | undefined, fallback: string, max: number) => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim() || fallback;
  return normalized.slice(0, max);
};

const buildOrderId = (prefix: "SUBM" | "KRM", id: string) =>
  `${prefix}-${Date.now()}-${id.slice(0, 8)}-${randomUUID().slice(0, 6)}`;

const buildRegistrationPayload = (params: {
  baseUrl: string;
  orderId: string;
  amountKrw: number;
  productName: string;
  buyerName: string;
  buyerEmail?: string | null;
  context: "submission" | "karaoke";
}) => {
  const config = getMobiliansConfig();
  const okUrl = new URL("/api/mobilians/return", params.baseUrl).toString();
  const notiUrl = new URL("/api/mobilians/noti", params.baseUrl).toString();
  const closeUrl = new URL(
    `/api/mobilians/close?oid=${encodeURIComponent(params.orderId)}`,
    params.baseUrl,
  ).toString();
  const failUrl = new URL("/api/mobilians/return?fail=1", params.baseUrl).toString();
  const timeStamp = getMobiliansTimestamp();
  const amount = String(params.amountKrw);
  const hmac = makeRegistrationHmac(
    {
      amount,
      okUrl,
      tradeId: params.orderId,
      timeStamp,
    },
    config.skey,
  );

  const payload: MobiliansRegistrationRequest = {
    sid: config.sid,
    cash_code: config.cashCode,
    product_name: compact(params.productName, "온사이드 결제", 50),
    trade_id: params.orderId,
    amount: { total: amount },
    site_url: getMobiliansSiteUrl(params.baseUrl),
    ok_url: okUrl,
    call_type: "P",
    hybrid_pay: "Y",
    noti_url: notiUrl,
    close_url: closeUrl,
    fail_url: failUrl,
    user_name: compact(params.buyerName, "회원", 50),
    user_email: compact(params.buyerEmail, "", 30),
    only_once: "Y",
    time_stamp: timeStamp,
    mstr: `context=${params.context}`,
    cp_logo: "N",
    hmac,
  };

  return { payload, okUrl, notiUrl, closeUrl, failUrl, timeStamp };
};

const scrubRegistrationPayload = (payload: MobiliansRegistrationRequest) => ({
  ...payload,
  hmac: payload.hmac ? "[masked]" : "",
});

const buildRawRegistration = (
  request: MobiliansRegistrationRequest,
  response?: MobiliansRegistrationResponse | null,
) => ({
  provider: "MOBILIANS",
  registrationRequest: scrubRegistrationPayload(request),
  registrationResponse: response ?? null,
});

const formatMobiliansConfigError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Missing environment variables")) {
    return "모빌리언스 결제 설정이 없습니다. MOBILIANS_ENV와 현재 모드의 MOBILIANS_SID/SKEY를 설정해주세요.";
  }
  if (message.includes("site_url must be 20 characters")) {
    return "모빌리언스 사이트 URL 설정이 너무 깁니다. MOBILIANS_SITE_URL을 모빌리언스에 등록된 20자 이하 도메인으로 설정해주세요.";
  }
  return "모빌리언스 결제 설정을 확인할 수 없습니다.";
};

export const createMobiliansSubmissionPaymentOrder = async (
  submissionId: string,
  baseUrl: string,
): Promise<{ error?: string; result?: MobiliansPayInitResult }> => {
  const { submission, error } = await findSubmissionById(submissionId);
  if (error || !submission) {
    return { error: "접수를 찾을 수 없습니다." };
  }
  if (submission.payment_status === "PAID") {
    return { error: "이미 결제가 완료된 접수입니다." };
  }
  if (submission.status === "DRAFT") {
    return { error: "임시저장 상태에서는 결제를 시작할 수 없습니다." };
  }
  if (submission.payment_method === "BANK") {
    return { error: "무통장 입금 접수는 카드 결제를 시작할 수 없습니다." };
  }

  const amountKrw = Math.round(Number(submission.amount_krw ?? 0));
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
    return { error: "결제 금액이 유효하지 않습니다." };
  }

  const orderId = buildOrderId("SUBM", submission.id);
  const packageName = Array.isArray(submission.package)
    ? (submission.package as Array<{ name?: string }>)[0]?.name
    : (submission.package as { name?: string } | null | undefined)?.name;
  const productName =
    packageName ?? submission.title ?? submission.artist_name ?? "심의 접수";
  const buyerName =
    submission.applicant_name ??
    submission.artist_name ??
    packageName ??
    "회원";
  let registration: ReturnType<typeof buildRegistrationPayload>;
  let config: ReturnType<typeof getMobiliansConfig>;
  try {
    registration = buildRegistrationPayload({
      baseUrl,
      orderId,
      amountKrw,
      productName,
      buyerName,
      buyerEmail: submission.applicant_email,
      context: "submission",
    });
    config = getMobiliansConfig();
  } catch (configError) {
    console.error("[Mobilians][submission][config-error]", configError);
    return { error: formatMobiliansConfigError(configError) };
  }
  const admin = createAdminClient();

  const { error: insertError } = await admin.from("submission_payments").insert({
    submission_id: submission.id,
    user_id: submission.user_id ?? null,
    order_id: orderId,
    amount_krw: amountKrw,
    status: "REQUESTED",
    raw_response: buildRawRegistration(registration.payload),
  });
  if (insertError) {
    return { error: "결제 요청을 저장하지 못했습니다." };
  }

  console.info("[Mobilians][submission][registration]", {
    mode: getMobiliansMode(),
    sid: maskSid(config.sid),
    orderId,
    amountKrw,
    okUrl: registration.payload.ok_url,
    closeUrl: registration.payload.close_url,
    baseUrl,
  });

  try {
    const response = await requestMobiliansRegistration(registration.payload);
    await admin
      .from("submission_payments")
      .update({
        pg_tid: response.tid ?? null,
        result_code: response.code ?? null,
        result_message: response.message ?? null,
        raw_response: buildRawRegistration(registration.payload, response),
      })
      .eq("order_id", orderId);

    if (
      !isMobiliansSuccessCode(response.code) ||
      !response.tid ||
      !response.pay_url
    ) {
      await admin
        .from("submission_payments")
        .update({
          status: "FAILED",
          result_code: response.code ?? "REGISTRATION_FAILED",
          result_message: response.message ?? "모빌리언스 거래 등록 실패",
        })
        .eq("order_id", orderId);
      return { error: response.message ?? "모빌리언스 거래 등록에 실패했습니다." };
    }

    return {
      result: {
        provider: "mobilians",
        orderId,
        tid: response.tid,
        payUrl: response.pay_url,
        amount: amountKrw,
      },
    };
  } catch (registrationError) {
    const message =
      registrationError instanceof Error
        ? registrationError.message
        : "모빌리언스 거래 등록에 실패했습니다.";
    await admin
      .from("submission_payments")
      .update({
        status: "FAILED",
        result_code: "REGISTRATION_ERROR",
        result_message: message,
      })
      .eq("order_id", orderId);
    return { error: "모빌리언스 결제 요청 생성에 실패했습니다." };
  }
};

export const createMobiliansKaraokePaymentOrder = async (
  requestId: string,
  baseUrl: string,
): Promise<{ error?: string; result?: MobiliansPayInitResult }> => {
  const { request, error } = await findKaraokeRequestById(requestId);
  if (error || !request) {
    return { error: "요청을 찾을 수 없습니다." };
  }
  if (request.payment_status === "PAID") {
    return { error: "이미 결제가 완료된 요청입니다." };
  }
  if (request.payment_method === "BANK") {
    return { error: "무통장 입금 요청은 카드 결제를 시작할 수 없습니다." };
  }

  const amountKrw = Math.round(Number(request.amount_krw ?? 0));
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
    return { error: "결제 금액이 유효하지 않습니다." };
  }

  const orderId = buildOrderId("KRM", request.id);
  let registration: ReturnType<typeof buildRegistrationPayload>;
  let config: ReturnType<typeof getMobiliansConfig>;
  try {
    registration = buildRegistrationPayload({
      baseUrl,
      orderId,
      amountKrw,
      productName: request.title ?? "노래방 등록 대행",
      buyerName: request.artist ?? request.contact ?? "회원",
      buyerEmail: "",
      context: "karaoke",
    });
    config = getMobiliansConfig();
  } catch (configError) {
    console.error("[Mobilians][karaoke][config-error]", configError);
    return { error: formatMobiliansConfigError(configError) };
  }
  const admin = createAdminClient();

  const { error: insertError } = await admin.from("karaoke_payments").insert({
    request_id: request.id,
    user_id: request.user_id,
    order_id: orderId,
    amount_krw: amountKrw,
    status: "REQUESTED",
    raw_response: buildRawRegistration(registration.payload),
  });
  if (insertError) {
    return { error: "결제 요청을 저장하지 못했습니다." };
  }

  await admin
    .from("karaoke_requests")
    .update({
      payment_method: "CARD",
      payment_status: "PAYMENT_PENDING",
      order_id: orderId,
    })
    .eq("id", request.id);

  console.info("[Mobilians][karaoke][registration]", {
    mode: getMobiliansMode(),
    sid: maskSid(config.sid),
    orderId,
    amountKrw,
    okUrl: registration.payload.ok_url,
    closeUrl: registration.payload.close_url,
    baseUrl,
  });

  try {
    const response = await requestMobiliansRegistration(registration.payload);
    await admin
      .from("karaoke_payments")
      .update({
        pg_tid: response.tid ?? null,
        result_code: response.code ?? null,
        result_message: response.message ?? null,
        raw_response: buildRawRegistration(registration.payload, response),
      })
      .eq("order_id", orderId);

    if (
      !isMobiliansSuccessCode(response.code) ||
      !response.tid ||
      !response.pay_url
    ) {
      await admin
        .from("karaoke_payments")
        .update({
          status: "FAILED",
          result_code: response.code ?? "REGISTRATION_FAILED",
          result_message: response.message ?? "모빌리언스 거래 등록 실패",
        })
        .eq("order_id", orderId);
      return { error: response.message ?? "모빌리언스 거래 등록에 실패했습니다." };
    }

    return {
      result: {
        provider: "mobilians",
        orderId,
        tid: response.tid,
        payUrl: response.pay_url,
        amount: amountKrw,
      },
    };
  } catch (registrationError) {
    const message =
      registrationError instanceof Error
        ? registrationError.message
        : "모빌리언스 거래 등록에 실패했습니다.";
    await admin
      .from("karaoke_payments")
      .update({
        status: "FAILED",
        result_code: "REGISTRATION_ERROR",
        result_message: message,
      })
      .eq("order_id", orderId);
    return { error: "모빌리언스 결제 요청 생성에 실패했습니다." };
  }
};
