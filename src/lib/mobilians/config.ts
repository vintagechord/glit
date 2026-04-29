type MobiliansMode = "prod" | "stg";

export type MobiliansEnvConfig = {
  env: MobiliansMode;
  sid: string;
  skey: string;
  apiBaseUrl: string;
  cashCode: string;
};

const clean = (value?: string | null) => {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
};

const normalizeMode = (value?: string | null): MobiliansMode | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "prod" || normalized === "production" || normalized === "live") {
    return "prod";
  }
  if (
    normalized === "stg" ||
    normalized === "stage" ||
    normalized === "staging" ||
    normalized === "test"
  ) {
    return "stg";
  }
  return null;
};

const hasMobiliansEnv = (mode: MobiliansMode) => {
  const suffix = mode === "prod" ? "PROD" : "STG";
  return Boolean(
    (clean(process.env[`MOBILIANS_SID_${suffix}`]) ||
      clean(process.env.MOBILIANS_SID)) &&
      (clean(process.env[`MOBILIANS_SKEY_${suffix}`]) ||
        clean(process.env.MOBILIANS_SKEY)),
  );
};

export const getMobiliansMode = (): MobiliansMode => {
  const override =
    normalizeMode(process.env.MOBILIANS_ENV) ??
    normalizeMode(process.env.NEXT_PUBLIC_MOBILIANS_ENV);
  if (override) return override;

  const prodReady = hasMobiliansEnv("prod");
  const stgReady = hasMobiliansEnv("stg");
  if (prodReady || !stgReady) return "prod";
  return "stg";
};

export const getMobiliansConfig = (): MobiliansEnvConfig => {
  const env = getMobiliansMode();
  const suffix = env === "prod" ? "PROD" : "STG";
  const sid =
    clean(process.env[`MOBILIANS_SID_${suffix}`]) ||
    clean(process.env.MOBILIANS_SID);
  const skey =
    clean(process.env[`MOBILIANS_SKEY_${suffix}`]) ||
    clean(process.env.MOBILIANS_SKEY);
  const apiBaseUrl =
    clean(process.env[`MOBILIANS_API_URL_${suffix}`]) ||
    clean(process.env.MOBILIANS_API_URL) ||
    (env === "prod"
      ? "https://mup.mobilians.co.kr"
      : "https://test.mobilians.co.kr");
  const cashCode =
    clean(process.env[`MOBILIANS_CASH_CODE_${suffix}`]) ||
    clean(process.env.MOBILIANS_CASH_CODE) ||
    "CN";

  if (!sid || !skey) {
    throw new Error(
      `[Mobilians] Missing environment variables for mode=${env}. Please set MOBILIANS_SID_${suffix}, MOBILIANS_SKEY_${suffix}.`,
    );
  }

  if (process.env.NODE_ENV !== "production") {
    const masked =
      sid.length <= 4 ? `${sid.slice(0, 2)}**` : `${sid.slice(0, 2)}***${sid.slice(-2)}`;
    console.info("[Mobilians][config]", {
      env,
      sid: masked,
      skeyLen: skey.length,
      apiBaseUrl,
      cashCode,
    });
  }

  return { env, sid, skey, apiBaseUrl, cashCode };
};

export const getMobiliansSiteUrl = (baseUrl: string) => {
  const configured = clean(process.env.MOBILIANS_SITE_URL);
  const value = configured
    ? configured
    : (() => {
        try {
          return new URL(baseUrl).hostname;
        } catch {
          return "onside.co.kr";
        }
      })();
  if (value.length > 20) {
    throw new Error(
      "[Mobilians] site_url must be 20 characters or fewer. Set MOBILIANS_SITE_URL to the registered short domain.",
    );
  }
  return value;
};
