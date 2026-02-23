import { getBillingConfig, getStdPayConfig } from "./config";
import {
  makeAuthRequestSignature,
  makeAuthSecureSignature,
  makeBillingHashDataV2,
  makeRefundHashDataV2,
  getInicisTimestamp,
} from "./crypto";

export const isInicisSuccessCode = (code?: string | number | null) => {
  const normalized = code == null ? "" : String(code);
  return normalized === "0000" || normalized === "00";
};

const REQUEST_TIMEOUT_MS = 15_000;

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

const isHttpsUrl = (value: string | null | undefined) => {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const readJsonBody = async (
  response: Response,
): Promise<InicisResponseData | null> => {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as InicisResponseData;
    }
    return { raw: text.slice(0, 800) };
  } catch {
    return { raw: text.slice(0, 800) };
  }
};

type StandardAuthParams = {
  authUrl: string;
  netCancelUrl?: string | null;
  authToken: string;
  timestamp: string;
  skipNetCancel?: boolean;
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
  error?: unknown;
};

export async function requestStdPayApproval({
  authUrl,
  netCancelUrl,
  authToken,
  timestamp,
  skipNetCancel = false,
}: StandardAuthParams): Promise<InicisApprovalResult> {
  if (!authToken.trim()) {
    return {
      ok: false,
      data: {
        resultCode: "AUTH_TOKEN_MISSING",
        resultMsg: "인증 토큰이 비어 있습니다.",
      },
    };
  }
  if (!timestamp.trim()) {
    return {
      ok: false,
      data: {
        resultCode: "TIMESTAMP_MISSING",
        resultMsg: "요청 타임스탬프가 비어 있습니다.",
      },
    };
  }
  if (!isTrustedInicisUrl(authUrl)) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_AUTH_URL",
        resultMsg: "승인 URL이 유효하지 않습니다.",
      },
    };
  }
  if (netCancelUrl && !isTrustedInicisUrl(netCancelUrl)) {
    return {
      ok: false,
      data: {
        resultCode: "INVALID_NETCANCEL_URL",
        resultMsg: "망취소 URL이 유효하지 않습니다.",
      },
    };
  }

  const { mid, signKey } = getStdPayConfig();
  const signature = makeAuthRequestSignature({ authToken, timestamp });
  const payload = {
    mid,
    authToken,
    signature,
    timestamp,
    charset: "UTF-8",
    format: "JSON",
  };

  const formBody = new URLSearchParams(
    Object.entries(payload).map(([k, v]) => [k, String(v ?? "")]),
  );

  const doNetCancel = async () => {
    if (!netCancelUrl || skipNetCancel) return null;
    try {
      await fetchWithTimeout(netCancelUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody,
        cache: "no-store",
      });
    } catch {
      // swallow network cancel errors
    }
    return null;
  };

  try {
    const res = await fetchWithTimeout(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
      cache: "no-store",
    });

    const data =
      (await readJsonBody(res)) ??
      ({
        resultCode: String(res.status),
        resultMsg: "승인 응답 본문이 비어 있습니다.",
      } as Record<string, string | number | null | undefined>);
    if (!res.ok) {
      await doNetCancel();
      return {
        ok: false,
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

    const moid = data.MOID != null ? String(data.MOID) : "";
    const totPriceRaw = data.TotPrice != null ? data.TotPrice : "";
    const totPrice = typeof totPriceRaw === "string" ? totPriceRaw.replace(/,/g, "") : totPriceRaw;
    const resultCode = data.resultCode != null ? String(data.resultCode) : "";
    const authSignature = data.authSignature != null ? String(data.authSignature) : null;
    const secureSignature = moid
      ? makeAuthSecureSignature({
          mid,
          tstamp: data.tstamp ?? timestamp,
          MOID: moid,
          TotPrice: totPrice,
          signKey,
        })
      : null;

    const success = isInicisSuccessCode(resultCode);

    if (!success) {
      await doNetCancel();
      return {
        ok: false,
        data,
        secureSignatureMatches: false,
      };
    }

    if (authSignature && secureSignature && authSignature !== secureSignature) {
      await doNetCancel();
      return { ok: false, data, secureSignatureMatches: false };
    }

    if (!secureSignature || !authSignature) {
      return { ok: true, data, secureSignatureMatches: false };
    }

    return { ok: true, data, secureSignatureMatches: true };
  } catch (error) {
    await doNetCancel();
    return { ok: false, data: null, error };
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
    });

    const dataResponse = await readJsonBody(res);
    const resultCode =
      dataResponse?.resultCode != null ? String(dataResponse.resultCode) : "";
    const ok = res.ok && (resultCode === "00" || resultCode === "01");

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
    });

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
