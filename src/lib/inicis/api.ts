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

export async function requestStdPayApproval({
  authUrl,
  netCancelUrl,
  authToken,
  timestamp,
  skipNetCancel = false,
}: StandardAuthParams) {
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
      await fetch(netCancelUrl, {
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
    const res = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
      cache: "no-store",
    });

    const data = (await res.json()) as Record<string, string | number | null | undefined>;
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

    if (!secureSignature || authSignature !== secureSignature) {
      return { ok: true, data, secureSignatureMatches: false };
    }

    return { ok: true, data, secureSignatureMatches: true };
  } catch (error) {
    await doNetCancel();
    return { ok: false, data: null, error };
  }
}

export async function requestBillingPayment(payload: BillingRequest) {
  const config = getBillingConfig();
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

  const res = await fetch(`${config.apiUrl}/v2/pg/billing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  let dataResponse: Record<string, string | number | null | undefined> | null = null;
  try {
    dataResponse = (await res.json()) as Record<string, string | number | null | undefined>;
  } catch {
    dataResponse = null;
  }

  const ok =
    dataResponse?.resultCode === "00" || dataResponse?.resultCode === "01";

  return { ok, data: dataResponse };
}

export async function requestRefund(payload: RefundRequest) {
  const config = getBillingConfig();
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

  const res = await fetch(`${config.apiUrl}/v2/pg/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  let dataResponse: Record<string, string | number | null | undefined> | null = null;
  try {
    dataResponse = (await res.json()) as Record<string, string | number | null | undefined>;
  } catch {
    dataResponse = null;
  }

  const ok = dataResponse?.resultCode === "00";
  return { ok, data: dataResponse };
}
