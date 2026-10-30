import { createHash } from "node:crypto";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { readBoundedBodyBytes } from "@/lib/request-body";

/**
 * KG INIpayMobile general payment (card). Source: https://manual.inicis.com/pay/stdpay_pc.html#mo
 * STEP 1 POST https://mobile.inicis.com/smart/payment/ (EUC-KR form, top-level navigation)
 * STEP 2 gateway → P_NEXT_URL (POST or GET): P_STATUS, P_RMESG1, P_TID, P_AMT, idc_name, P_REQ_URL, P_NOTI
 * STEP 3 merchant → P_REQ_URL (form POST): P_MID, P_TID
 * STEP 4 approval result key=value&…: P_STATUS "00", P_TID, P_MID, P_OID, P_AMT, P_TYPE, P_AUTH_DT …
 * Net cancel: {P_REQ_URL host}/smart/payNetCancel.ini with P_TID, P_MID, P_AMT, P_OID, P_TIMESTAMP, P_CHKFAKE
 */
export type InicisMobileData = Record<string, string>;

export type InicisMobileRequest = {
  actionUrl: string;
  params: Record<string, string>;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESPONSE_FIELDS = 128;
const orderIdPattern = /^[A-Za-z0-9_-]{1,40}$/;
const tidPattern = /^[A-Za-z0-9_-]{5,40}$/;
const merchantDataPattern = /^[A-Za-z0-9_-]{1,600}$/;
// P_OID / P_NOTI and plain fields may not carry : ? ' " & or line breaks.
const forbiddenValueChars = /[:?'"&\u0000-\u001f\u007f]/g;

export const makeInicisMobileChkFake = (params: {
  amountKrw: number | string;
  orderId: string;
  timestamp: string;
  hashKey: string;
}) =>
  createHash("sha512")
    .update(`${params.amountKrw}${params.orderId}${params.timestamp}${params.hashKey}`, "utf8")
    .digest("base64");

const limitBytes = (value: string, limit: number) => {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character, "utf8") > limit) break;
    result += character;
  }
  return result;
};

const plainField = (value: string | null | undefined, limit: number) =>
  limitBytes((value ?? "").replace(forbiddenValueChars, " ").replace(/\s+/g, " ").trim(), limit);

export const isValidInicisMobileTimestamp = (value: string) => /^[1-9][0-9]{12}$/.test(value);

export function buildInicisMobileRequest(
  params: {
    actionUrl: string;
    mid: string;
    hashKey: string;
    orderId: string;
    amountKrw: number;
    productName: string;
    buyerName: string;
    buyerEmail?: string | null;
    buyerTel?: string | null;
    nextUrl: string;
    merchantData: string;
    language?: "ko" | "en";
    merchantName?: string;
  },
  timestamp = Date.now().toString(),
): InicisMobileRequest {
  if (!/^https:\/\/(?:stg)?mobile\.inicis\.com\/smart\/payment\/$/.test(params.actionUrl)) {
    throw new Error("모바일 결제 요청 주소가 유효하지 않습니다.");
  }
  if (!orderIdPattern.test(params.orderId)) throw new Error("결제 주문번호가 유효하지 않습니다.");
  if (!Number.isSafeInteger(params.amountKrw) || params.amountKrw <= 0 || String(params.amountKrw).length > 8) {
    throw new Error("결제 금액이 유효하지 않습니다.");
  }
  if (!merchantDataPattern.test(params.merchantData)) throw new Error("결제 요청 인증값이 유효하지 않습니다.");
  if (!params.hashKey.trim()) throw new Error("모바일 결제 해시 키가 설정되지 않았습니다.");
  if (!isValidInicisMobileTimestamp(timestamp)) throw new Error("결제 요청 시각이 유효하지 않습니다.");
  let nextUrl: URL;
  try { nextUrl = new URL(params.nextUrl); } catch { throw new Error("결제 결과 수신 주소가 유효하지 않습니다."); }
  if (nextUrl.protocol !== "https:" && nextUrl.hostname !== "localhost") {
    throw new Error("결제 결과 수신 주소는 HTTPS여야 합니다.");
  }

  const email = (params.buyerEmail ?? "").trim();
  const tel = (params.buyerTel ?? "").replace(/[^0-9-]/g, "").slice(0, 15);
  const request: Record<string, string> = {
    P_INI_PAYMENT: "CARD",
    P_MID: params.mid,
    P_OID: params.orderId,
    P_AMT: String(params.amountKrw),
    P_GOODS: plainField(params.productName, 80) || "심의 접수",
    P_UNAME: plainField(params.buyerName, 30) || "회원",
    P_MNAME: plainField(params.merchantName ?? "온사이드", 40),
    P_NEXT_URL: nextUrl.toString(),
    P_NOTI: params.merchantData,
    P_CHARSET: "utf8",
    P_LANG: params.language === "en" ? "en" : "ko",
    P_TIMESTAMP: timestamp,
    P_CHKFAKE: makeInicisMobileChkFake({
      amountKrw: params.amountKrw, orderId: params.orderId, timestamp, hashKey: params.hashKey,
    }),
    P_RESERVED: "centerCd=Y&amt_hash=Y",
  };
  if (email && /^[A-Za-z0-9@.]+$/.test(email) && email.length <= 30 && email.includes("@")) request.P_EMAIL = email;
  if (tel) request.P_MOBILE = tel;
  return { actionUrl: params.actionUrl, params: request };
}

/** P_NOTI carries "<orderId>_<closeState>" so the auth result identifies the order. */
export const encodeInicisMobileMerchantData = (orderId: string, closeState: string) => `${orderId}_${closeState}`;

export const decodeInicisMobileMerchantData = (value: string | null | undefined) => {
  if (!value || !merchantDataPattern.test(value)) return null;
  const separator = value.lastIndexOf("_");
  if (separator <= 0 || separator === value.length - 1) return null;
  const orderId = value.slice(0, separator);
  const closeState = value.slice(separator + 1);
  if (!orderIdPattern.test(orderId) || closeState.length < 32) return null;
  return { orderId, closeState };
};

export function isTrustedInicisMobileRequestUrl(
  value: string | null | undefined,
  center: string | null | undefined,
  mode: "prod" | "stg",
) {
  if (!value || !center) return false;
  const match = /^https:\/\/(fc|ks|stg)mobile\.inicis\.com(?::443)?\/smart\/payReq\.ini$/.exec(value);
  return Boolean(
    match && match[1] === center &&
    (mode === "stg" ? center === "stg" : center === "fc" || center === "ks"),
  );
}

export const getInicisMobileNetCancelUrl = (requestUrl: string) =>
  `${new URL(requestUrl).origin}/smart/payNetCancel.ini`;

/** Approval and cancel responses are "key=value&key=value" text, UTF-8 when
 * P_CHARSET=utf8 was requested and EUC-KR otherwise. */
export function parseInicisMobileResponse(bytes: Uint8Array): InicisMobileData | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try { text = new TextDecoder("euc-kr", { fatal: true }).decode(bytes); } catch { return null; }
  }
  const source = text.trim();
  if (!source || source.startsWith("<")) return null;
  const data: InicisMobileData = Object.create(null);
  let count = 0;
  for (const field of source.split("&")) {
    if (!field) continue;
    if (++count > MAX_RESPONSE_FIELDS) return null;
    const separator = field.indexOf("=");
    const key = (separator < 0 ? field : field.slice(0, separator)).trim();
    const rawValue = separator < 0 ? "" : field.slice(separator + 1);
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || Object.hasOwn(data, key)) return null;
    let value = rawValue;
    if (/%[0-9A-Fa-f]{2}/.test(rawValue)) {
      try { value = decodeURIComponent(rawValue.replace(/\+/g, " ")); } catch { value = rawValue; }
    }
    data[key] = value.slice(0, 8192);
  }
  return data;
}

export function validateInicisMobileCardReceipt(
  data: InicisMobileData,
  expected: { mid: string; orderId: string; amountKrw: number },
): string | null {
  if (data.P_STATUS !== "00") return "RESULT_CODE_MISMATCH";
  if (data.P_MID !== expected.mid) return "MID_MISMATCH";
  if (data.P_OID !== expected.orderId) return "ORDER_ID_MISMATCH";
  if (!Number.isSafeInteger(expected.amountKrw) || expected.amountKrw <= 0 ||
      String(data.P_AMT ?? "").replace(/,/g, "").trim() !== String(expected.amountKrw)) return "PRICE_MISMATCH";
  if ((data.P_TYPE ?? "").toUpperCase() !== "CARD") return "PAYMENT_METHOD_MISMATCH";
  if (typeof data.P_TID !== "string" || !tidPattern.test(data.P_TID)) return "TID_MISSING";
  const authDate = String(data.P_AUTH_DT ?? "");
  if (!/^\d{14}$/.test(authDate)) return "APPROVAL_DATE_INVALID";
  const parsed = new Date(`${authDate.slice(0, 4)}-${authDate.slice(4, 6)}-${authDate.slice(6, 8)}T${authDate.slice(8, 10)}:${authDate.slice(10, 12)}:${authDate.slice(12)}Z`);
  if (!Number.isFinite(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 19).replace(/[-:T]/g, "") !== authDate) return "APPROVAL_DATE_INVALID";
  return null;
}

type MobileGatewayResult = {
  ok: boolean;
  data: InicisMobileData | null;
  httpStatus?: number;
  error?: unknown;
};

const postForm = async (url: string, body: URLSearchParams, fetcher: typeof fetch = fetch): Promise<MobileGatewayResult> => {
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      redirect: "error",
    }, REQUEST_TIMEOUT_MS, fetcher);
    const bytes = await readBoundedBodyBytes(response, MAX_RESPONSE_BYTES);
    const data = bytes.ok ? parseInicisMobileResponse(bytes.bytes) : null;
    return { ok: response.ok, data, httpStatus: response.status };
  } catch (error) {
    return { ok: false, data: null, error };
  }
};

export async function requestInicisMobileApproval(params: {
  requestUrl: string;
  idcName: string;
  mode: "prod" | "stg";
  mid: string;
  authTid: string;
}, fetcher: typeof fetch = fetch): Promise<MobileGatewayResult & { confirmedFailure: boolean }> {
  if (!isTrustedInicisMobileRequestUrl(params.requestUrl, params.idcName, params.mode)) {
    return { ok: false, data: { P_STATUS: "INVALID_REQ_URL", P_RMESG1: "승인 URL이 유효하지 않습니다." }, confirmedFailure: false };
  }
  if (!tidPattern.test(params.authTid)) {
    return { ok: false, data: { P_STATUS: "AUTH_TID_INVALID", P_RMESG1: "인증 거래번호가 유효하지 않습니다." }, confirmedFailure: false };
  }
  const result = await postForm(params.requestUrl, new URLSearchParams({ P_MID: params.mid, P_TID: params.authTid }), fetcher);
  if (!result.ok || !result.data) {
    // Timeouts and unreadable bodies are not proof that no charge happened.
    return { ...result, ok: false, confirmedFailure: false };
  }
  const status = result.data.P_STATUS ?? "";
  if (status !== "00") {
    return { ...result, ok: false, confirmedFailure: /^[0-9A-Za-z]{2,6}$/.test(status) };
  }
  return { ...result, ok: true, confirmedFailure: false };
}

export async function requestInicisMobileNetCancel(params: {
  requestUrl: string;
  idcName: string;
  mode: "prod" | "stg";
  mid: string;
  authTid: string;
  orderId: string;
  amountKrw: number;
  hashKey: string;
}, fetcher: typeof fetch = fetch, timestamp = Date.now().toString()): Promise<MobileGatewayResult> {
  if (!isTrustedInicisMobileRequestUrl(params.requestUrl, params.idcName, params.mode) ||
      !tidPattern.test(params.authTid) || !orderIdPattern.test(params.orderId) ||
      !Number.isSafeInteger(params.amountKrw) || params.amountKrw <= 0 || !isValidInicisMobileTimestamp(timestamp)) {
    return { ok: false, data: null, error: new Error("망취소 요청 정보가 유효하지 않습니다.") };
  }
  const result = await postForm(getInicisMobileNetCancelUrl(params.requestUrl), new URLSearchParams({
    P_TID: params.authTid,
    P_MID: params.mid,
    P_AMT: String(params.amountKrw),
    P_OID: params.orderId,
    P_TIMESTAMP: timestamp,
    P_CHKFAKE: makeInicisMobileChkFake({ amountKrw: params.amountKrw, orderId: params.orderId, timestamp, hashKey: params.hashKey }),
  }), fetcher);
  // A status alone cannot prove that this order was cancelled.
  const ok = result.ok && result.data?.P_STATUS === "00" &&
    (!result.data.P_OID || result.data.P_OID === params.orderId);
  return { ...result, ok };
}
