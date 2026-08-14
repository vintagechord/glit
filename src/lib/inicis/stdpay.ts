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
  const price = Math.max(0, params.amountKrw);

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
    goodname: params.productName,
    buyername: params.buyerName,
    buyertel: params.buyerTel ?? "",
    buyeremail: params.buyerEmail ?? "",
    returnUrl: params.returnUrl,
    closeUrl: params.closeUrl ?? params.returnUrl,
    ...(merchantData ? { merchantData } : {}),
    ...(billing
      ? {
          use_chkfake: "Y",
          acceptmethod: "BILLAUTH(Card):centerCd(Y)",
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
