import {
  getBillingConfig,
  getStdPayConfig,
  getSubscriptionPrice,
} from "./config";
import {
  getInicisTimestamp,
  makeOrderId,
  makeStdPaySignature,
  makeStdPayVerification,
  makeMobileHashData,
  sha256,
} from "./crypto";

export type StdPayRequestParams = {
  orderId?: string;
  amountKrw: number;
  productName: string;
  buyerName: string;
  buyerEmail?: string | null;
  buyerTel?: string | null;
  returnUrl: string;
  closeUrl?: string;
  merchantData?: string;
  billing?: {
    callbackState: string;
    offerPeriod?: string;
  };
};

export type MobileBillingParams = {
  orderId?: string;
  amountKrw: number;
  productName: string;
  buyerName: string;
  buyerEmail?: string | null;
  buyerTel?: string | null;
  returnUrl: string;
  callbackState: string;
  period?: string;
};

export const buildStdPayRequest = (
  params: StdPayRequestParams,
  timestamp = Date.now().toString(),
) => {
  const config = getStdPayConfig();
  const oid = params.orderId ?? makeOrderId("SUB");
  const price = params.amountKrw;
  if (!Number.isSafeInteger(price) || price <= 0 || String(price).length > 12) {
    throw new Error("결제 금액이 유효하지 않습니다.");
  }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(oid)) {
    throw new Error("결제 주문번호가 유효하지 않습니다.");
  }
  const label = (value: string, limit: number) => {
    let result = "";
    for (const character of value.replace(/[\u0000-\u001f\u007f]/g, " ")) {
      if (Buffer.byteLength(result + character, "utf8") > limit) break;
      result += character;
    }
    return result;
  };

  const signature = makeStdPaySignature({
    oid,
    price,
    timestamp,
  });

  const verification = makeStdPayVerification({
    oid,
    price,
    timestamp,
    signKey: config.signKey,
  });

  const mKey = sha256(config.signKey);

  const billing = params.billing;
  const merchantData = billing?.callbackState ?? params.merchantData?.trim();
  const stdParams = {
    version: "1.0",
    gopaymethod: billing ? "" : "Card",
    currency: "WON",
    mid: config.mid,
    oid,
    price: String(price),
    timestamp,
    signature,
    verification,
    mKey,
    use_chkfake: "Y",
    acceptmethod: billing ? "BILLAUTH(Card):centerCd(Y)" : "centerCd(Y)",
    charset: "UTF-8",
    goodname: label(params.productName, 40),
    buyername: label(params.buyerName, 30),
    buyertel: params.buyerTel ?? "",
    buyeremail: params.buyerEmail ?? "",
    returnUrl: params.returnUrl,
    closeUrl: params.closeUrl ?? params.returnUrl,
    ...(merchantData ? { merchantData } : {}),
    ...(billing
      ? {
          offerPeriod: billing.offerPeriod ?? "M2",
        }
      : {}),
  };

  return stdParams;
};

export const buildMobileBillingRequest = (params: MobileBillingParams) => {
  const config = getBillingConfig();
  const orderId = params.orderId ?? makeOrderId("SUBM");
  const timestamp = getInicisTimestamp();
  const hashdata = makeMobileHashData({
    mid: config.mid,
    orderId,
    timestamp,
    liteKey: config.liteKey,
  });

  return {
    authtype: "D",
    mid: config.mid,
    orderid: orderId,
    price: String(Math.max(0, params.amountKrw)),
    goodname: params.productName,
    buyername: params.buyerName,
    buyeremail: params.buyerEmail ?? "",
    buyertel: params.buyerTel ?? "",
    timestamp,
    hashdata,
    returnurl: params.returnUrl,
    period: params.period ?? "M2",
    merchantreserved: params.callbackState,
    currency: "WON",
  };
};

export const resolveSubscriptionPrice = () => getSubscriptionPrice();
