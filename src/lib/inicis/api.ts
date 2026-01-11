import { getBillingConfig, getStdPayConfig } from "./config";
import {
  makeAuthRequestSignature,
  makeAuthSecureSignature,
  makeBillingHashDataV2,
  makeRefundHashDataV2,
  getInicisTimestamp,
} from "./crypto";

type StandardAuthParams = {
  authUrl: string;
  netCancelUrl?: string | null;
  authToken: string;
  timestamp: string;
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
}: StandardAuthParams) {
  const { mid } = getStdPayConfig();
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
    if (!netCancelUrl) return null;
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

    const data = (await res.json()) as Record<string, any>;
    const secureSignature = data.MOID
      ? makeAuthSecureSignature({
          mid,
          tstamp: data.tstamp ?? timestamp,
          MOID: data.MOID,
          TotPrice: data.TotPrice,
        })
      : null;

    if (data.resultCode !== "0000") {
      await doNetCancel();
      return { ok: false, data, secureSignatureMatches: false };
    }

    if (!secureSignature || data.authSignature !== secureSignature) {
      await doNetCancel();
      return { ok: false, data, secureSignatureMatches: false };
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

  let dataResponse: Record<string, any> | null = null;
  try {
    dataResponse = (await res.json()) as Record<string, any>;
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

  let dataResponse: Record<string, any> | null = null;
  try {
    dataResponse = (await res.json()) as Record<string, any>;
  } catch {
    dataResponse = null;
  }

  const ok = dataResponse?.resultCode === "00";
  return { ok, data: dataResponse };
}
