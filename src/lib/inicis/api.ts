import { getBillingConfig, getStdPayConfig } from "./config";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { readBoundedBodyBytes } from "@/lib/request-body";
import { isTrustedStdPayUrl, isValidInicisAuthToken, parseInicisJson } from "./protocol";
import {
  makeAuthRequestSignature,
  makeSignature,
  makeBillingHashDataV2,
  makeRefundHashDataV2,
  getInicisTimestamp,
} from "./crypto";

export const isInicisSuccessCode = (code?: string | number | null) => {
  const normalized = code == null ? "" : String(code);
  return normalized === "0000" || normalized === "00";
};

const REQUEST_TIMEOUT_MS = 15_000;

const isHttpsUrl = (value: string | null | undefined) => {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const readJsonBody = async (
  response: Response,
): Promise<InicisResponseData | null> => {
  const body = await readBoundedBodyBytes(response, 64 * 1024);
  if (!body.ok) return null;
  try {
    return parseInicisJson(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return null;
  }
};

type StandardAuthParams = {
  authUrl: string;
  netCancelUrl?: string | null;
  authToken: string;
  timestamp: string;
  skipNetCancel?: boolean;
  idcName?: string;
  expectedOrderId?: string;
  expectedAmountKrw?: number;
};

type BillingRequest = {
  billKey: string;
  orderId: string;
  amountKrw: number;
  goodName: string;
  buyerName: string;
  buyerEmail?: string | null;
  buyerTel?: string | null;
  clientIp?: string | null;
  url?: string;
};

type RefundRequest = {
  tid: string;
  message?: string;
  clientIp?: string | null;
};

type InicisResponseData = Record<string, string | number | null | undefined>;

type InicisApprovalResult = {
  ok: boolean;
  data: InicisResponseData | null;
  secureSignatureMatches?: boolean;
  confirmedFailure?: boolean;
  netCancellation?: InicisNetCancelResult | null;
  error?: unknown;
};

type InicisNetCancelResult = {
  ok: boolean;
  data: InicisResponseData | null;
  error?: unknown;
};

const buildStdAuthFormBody = (authToken: string, timestamp: string) => {
  const { mid, signKey } = getStdPayConfig();
  return new URLSearchParams({
    mid,
    authToken,
    signature: makeAuthRequestSignature({ authToken, timestamp }),
    verification: makeSignature({ authToken, signKey, timestamp }),
    timestamp,
    charset: "UTF-8",
    format: "JSON",
  });
};

export async function requestStdPayNetCancel({
  netCancelUrl,
  authToken,
  timestamp,
  idcName,
  expectedOrderId,
  expectedTid,
}: {
  netCancelUrl?: string | null;
  authToken: string;
  timestamp: string;
  idcName?: string;
  expectedOrderId?: string;
  expectedTid?: string;
}): Promise<InicisNetCancelResult> {
  if (
    !netCancelUrl ||
    !isTrustedStdPayUrl(netCancelUrl, idcName, getStdPayConfig().env, true) ||
    !isValidInicisAuthToken(authToken) ||
    !/^[1-9][0-9]{12}$/.test(timestamp)
  ) {
    return {
      ok: false,
      data: null,
      error: new Error("망취소 요청 정보가 유효하지 않습니다."),
    };
  }

  try {
    const response = await fetchWithTimeout(netCancelUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildStdAuthFormBody(authToken, timestamp),
      cache: "no-store",
      redirect: "error",
    }, REQUEST_TIMEOUT_MS);
    const data = await readJsonBody(response);
    const resultCode =
      data?.resultCode ?? data?.resultcode ?? data?.P_STATUS ?? null;
    const gatewayAccepted = resultCode === "0000";
    return {
      // A status code alone cannot prove that this order was cancelled.
      ok: response.ok && gatewayAccepted && Boolean(expectedOrderId) &&
        data?.mid === getStdPayConfig().mid && data?.MOID === expectedOrderId &&
        typeof data?.tid === "string" && /^[A-Za-z0-9_-]{5,40}$/.test(data.tid) &&
        (!expectedTid || data.tid === expectedTid),
      data,
    };
  } catch (error) {
    return { ok: false, data: null, error };
  }
}

export async function requestStdPayApproval({
  authUrl,
  netCancelUrl,
  authToken,
  timestamp,
  skipNetCancel = false,
  idcName,
  expectedOrderId,
  expectedAmountKrw,
}: StandardAuthParams): Promise<InicisApprovalResult> {
  if (!isValidInicisAuthToken(authToken)) {
    return {
      ok: false,
      data: {
        resultCode: "AUTH_TOKEN_MISSING",
        resultMsg: "인증 토큰이 비어 있습니다.",
      },
    };
  }
  if (!/^[1-9][0-9]{12}$/.test(timestamp)) {
    return {
      ok: false,
      data: {
        resultCode: "TIMESTAMP_MISSING",
        resultMsg: "요청 타임스탬프가 비어 있습니다.",
      },
    };
  }
  if (!isTrustedStdPayUrl(authUrl, idcName, getStdPayConfig().env)) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_AUTH_URL",
        resultMsg: "승인 URL이 유효하지 않습니다.",
      },
    };
  }
  if (netCancelUrl && !isTrustedStdPayUrl(netCancelUrl, idcName, getStdPayConfig().env, true)) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_NETCANCEL_URL",
        resultMsg: "망취소 URL이 유효하지 않습니다.",
      },
    };
  }

  const formBody = buildStdAuthFormBody(authToken, timestamp);
  if (expectedAmountKrw !== undefined) {
    if (!Number.isSafeInteger(expectedAmountKrw) || expectedAmountKrw <= 0) {
      return { ok: false, data: null, confirmedFailure: false };
    }
    formBody.set("price", String(expectedAmountKrw));
  }

  const doNetCancel = async () => {
    if (!netCancelUrl || skipNetCancel) return null;
    return requestStdPayNetCancel({ netCancelUrl, authToken, timestamp, idcName, expectedOrderId });
  };

  try {
    const res = await fetchWithTimeout(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
      cache: "no-store",
      redirect: "error",
    }, REQUEST_TIMEOUT_MS);

    const data =
      (await readJsonBody(res)) ??
      ({
        resultCode: String(res.status),
        resultMsg: "승인 응답 본문이 비어 있습니다.",
      } as Record<string, string | number | null | undefined>);
    if (!res.ok) {
      const netCancellation = await doNetCancel();
      return {
        ok: false,
        netCancellation,
        confirmedFailure: netCancellation?.ok === true,
        data: {
          ...data,
          resultCode:
            data.resultCode != null ? String(data.resultCode) : `HTTP_${res.status}`,
          resultMsg:
            data.resultMsg != null
              ? String(data.resultMsg)
              : "승인 서버 응답이 정상적이지 않습니다.",
          httpStatus: res.status,
        },
        secureSignatureMatches: false,
      };
    }

    const resultCode = data.resultCode != null ? String(data.resultCode) : "";
    const success = resultCode === "0000";

    if (!success) {
      const netCancellation = await doNetCancel();
      return {
        ok: false,
        data,
        netCancellation,
        // A missing or malformed result is not proof that no charge occurred.
        confirmedFailure: netCancellation?.ok === true || /^\d{4,6}$/.test(resultCode) && resultCode !== String(res.status),
        secureSignatureMatches: false,
      };
    }

    // Authenticity is established by the direct allowlisted HTTPS request;
    // callers must bind the documented receipt fields to their saved order.
    return { ok: true, data, secureSignatureMatches: false };
  } catch (error) {
    const netCancellation = await doNetCancel();
    return { ok: false, data: null, error, netCancellation, confirmedFailure: netCancellation?.ok === true };
  }
}

export async function requestBillingPayment(payload: BillingRequest): Promise<{
  ok: boolean;
  data: InicisResponseData | null;
}> {
  if (!payload.billKey?.trim() || !payload.orderId?.trim()) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_BILLING_PAYLOAD",
        resultMsg: "빌링 결제 요청 정보가 올바르지 않습니다.",
      },
    };
  }
  const config = getBillingConfig();
  if (!isHttpsUrl(config.apiUrl)) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_API_URL",
        resultMsg: "빌링 API URL 설정이 유효하지 않습니다.",
      },
    };
  }
  const timestamp = getInicisTimestamp();
  const type = "billing";
  const paymethod = "Card";
  const data = {
    url: payload.url ?? "",
    moid: payload.orderId,
    goodName: payload.goodName,
    buyerName: payload.buyerName,
    buyerEmail: payload.buyerEmail ?? "",
    buyerTel: payload.buyerTel ?? "",
    price: String(Math.max(0, payload.amountKrw)),
    billKey: payload.billKey,
    authentification: "00",
  };

  const dataString = JSON.stringify(data);
  const hashData = makeBillingHashDataV2({
    apiKey: config.apiKey,
    mid: config.mid,
    type,
    timestamp,
    data: dataString,
  });

  const body = {
    mid: config.mid,
    type,
    paymethod,
    timestamp,
    clientIp: payload.clientIp ?? "127.0.0.1",
    hashData,
    data,
  };

  try {
    const res = await fetchWithTimeout(`${config.apiUrl}/v2/pg/billing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
    }, REQUEST_TIMEOUT_MS);

    const dataResponse = await readJsonBody(res);
    const resultCode =
      dataResponse?.resultCode != null ? String(dataResponse.resultCode) : "";
    // KG Inicis documents only "00" as a successful billing approval.
    // Treat every other code as a failure so an unapproved response can never
    // activate a subscription.
    const ok = res.ok && resultCode === "00";

    return { ok, data: dataResponse };
  } catch (error) {
    return {
      ok: false,
      data: {
        resultCode: "NETWORK_ERROR",
        resultMsg:
          error instanceof Error
            ? `빌링 결제 요청 중 네트워크 오류: ${error.message}`
            : "빌링 결제 요청 중 네트워크 오류가 발생했습니다.",
      },
    };
  }
}

export async function requestRefund(payload: RefundRequest): Promise<{
  ok: boolean;
  data: InicisResponseData | null;
}> {
  if (!payload.tid?.trim()) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_REFUND_PAYLOAD",
        resultMsg: "환불 TID가 필요합니다.",
      },
    };
  }
  const config = getBillingConfig();
  if (!isHttpsUrl(config.apiUrl)) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_API_URL",
        resultMsg: "환불 API URL 설정이 유효하지 않습니다.",
      },
    };
  }
  const timestamp = getInicisTimestamp();
  const type = "refund";
  const data = {
    tid: payload.tid,
    msg: payload.message ?? "user requested",
  };
  const dataString = JSON.stringify(data);
  const hashData = makeRefundHashDataV2({
    apiKey: config.apiKey,
    mid: config.mid,
    type,
    timestamp,
    data: dataString,
  });

  const body = {
    mid: config.mid,
    type,
    timestamp,
    clientIp: payload.clientIp ?? "127.0.0.1",
    hashData,
    data,
  };

  try {
    const res = await fetchWithTimeout(`${config.apiUrl}/v2/pg/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
    }, REQUEST_TIMEOUT_MS);

    const dataResponse = await readJsonBody(res);
    const resultCode =
      dataResponse?.resultCode != null ? String(dataResponse.resultCode) : "";
    const ok = res.ok && resultCode === "00";
    return { ok, data: dataResponse };
  } catch (error) {
    return {
      ok: false,
      data: {
        resultCode: "NETWORK_ERROR",
        resultMsg:
          error instanceof Error
            ? `환불 요청 중 네트워크 오류: ${error.message}`
            : "환불 요청 중 네트워크 오류가 발생했습니다.",
      },
    };
  }
}
