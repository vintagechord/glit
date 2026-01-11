type InicisMode = "prod" | "stg";

export type StdPayEnvConfig = {
  env: InicisMode;
  mid: string;
  signKey: string;
  stdJsUrl: string;
};

export type BillingEnvConfig = {
  mid: string;
  apiKey: string;
  apiIv: string;
  liteKey: string;
  apiUrl: string;
};

const clean = (value?: string | null) => {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
};

const loadStdPayConfig = (mode: InicisMode): StdPayEnvConfig => {
  const suffix = mode === "prod" ? "PROD" : "STG";
  const mid = clean(process.env[`INICIS_MID_${suffix}`] ?? "");
  const signKey = clean(process.env[`INICIS_SIGN_KEY_${suffix}`] ?? "");
  const stdJsUrlRaw =
    mode === "prod"
      ? "https://stdpay.inicis.com/stdjs/INIStdPay.js"
      : process.env[`INICIS_STDJS_URL_${suffix}`] ??
        "https://stgstdpay.inicis.com/stdjs/INIStdPay.js";
  const stdJsUrl = clean(stdJsUrlRaw);

  if (!mid || !signKey) {
    throw new Error(
      `[Inicis] Missing STDPay environment variables for mode=${mode}. Please set INICIS_MID_${suffix}, INICIS_SIGN_KEY_${suffix}.`,
    );
  }

  const isProdJs = stdJsUrl.includes("stdpay.inicis.com");
  const isStgJs = stdJsUrl.includes("stgstdpay.inicis.com");
  if (mode === "stg" && isProdJs) {
    throw new Error("[Inicis] STDPay config mismatch: stg mode requires stgstdpay.inicis.com JS URL.");
  }
  if (mode === "prod" && isStgJs) {
    throw new Error("[Inicis] STDPay config mismatch: prod mode requires stdpay.inicis.com JS URL.");
  }

  if (process.env.NODE_ENV !== "production") {
    const masked = mid.length <= 4 ? `${mid.slice(0, 2)}**` : `${mid.slice(0, 2)}***${mid.slice(-2)}`;
    console.info("[Inicis][STDPay][config]", {
      env: mode,
      mid: masked,
      signKeyLen: signKey.length,
      stdJsUrl,
    });
  }

  return { env: mode, mid, signKey, stdJsUrl };
};

const loadBillingConfig = (mode: InicisMode): BillingEnvConfig => {
  const suffix = mode === "prod" ? "PROD" : "STG";
  const mid = clean(process.env[`INICIS_MID_${suffix}`] ?? "");
  const apiKey = clean(
    process.env[`INICIS_BILLING_API_KEY_${suffix}`] ?? "",
  );
  const apiIv = clean(
    process.env[`INICIS_BILLING_API_IV_${suffix}`] ?? "",
  );
  const liteKey = clean(process.env[`INICIS_LITE_KEY_${suffix}`] ?? "");
  const apiUrl = clean(process.env[`INICIS_API_URL_${suffix}`] ?? "");

  if (!mid || !apiKey || !apiIv || !liteKey || !apiUrl) {
    throw new Error(
      `[Inicis] Missing billing environment variables for mode=${mode}. Please set INICIS_MID_${suffix}, INICIS_BILLING_API_KEY_${suffix}, INICIS_BILLING_API_IV_${suffix}, INICIS_LITE_KEY_${suffix}, INICIS_API_URL_${suffix}.`,
    );
  }

  return { mid, apiKey, apiIv, liteKey, apiUrl };
};

// 운영 결제만 사용하도록 기본 prod 강제 (env에 stg가 있어도 prod 우선)
export const getInicisMode = (): InicisMode => "prod";

export const getStdPayConfig = (): StdPayEnvConfig =>
  loadStdPayConfig(getInicisMode());

export const getBillingConfig = (): BillingEnvConfig =>
  loadBillingConfig(getInicisMode());

export const getSubscriptionPrice = () => {
  const raw =
    process.env.SUBSCRIPTION_PRICE_KRW ??
    process.env.NEXT_PUBLIC_SUBSCRIPTION_PRICE_KRW ??
    "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.round(parsed);
};
