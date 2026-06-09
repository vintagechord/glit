import { APP_CONFIG } from "./config";

export type RuntimeHealthCheck = {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  detail?: string;
};

type InicisMode = "prod" | "stg";

type RuntimeHealthOptions = {
  strict?: boolean;
  includeOptionalNotifications?: boolean;
};

const truthy = (value: string | undefined | null) =>
  Boolean(value && value.trim().length > 0);

const clean = (value?: string | null) => value?.trim() ?? "";

const normalizeMode = (value?: string | null): InicisMode | null => {
  const normalized = clean(value).toLowerCase();
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

const hasStdPayEnv = (mode: InicisMode) => {
  const suffix = mode === "prod" ? "PROD" : "STG";
  return truthy(process.env[`INICIS_MID_${suffix}`]) &&
    truthy(process.env[`INICIS_SIGN_KEY_${suffix}`]);
};

const resolveInicisMode = (): InicisMode => {
  const override =
    normalizeMode(process.env.INICIS_ENV) ??
    normalizeMode(process.env.NEXT_PUBLIC_INICIS_ENV);
  if (override) return override;
  return hasStdPayEnv("prod") || !hasStdPayEnv("stg") ? "prod" : "stg";
};

const isAbsoluteHttpUrl = (value?: string | null) => {
  if (!truthy(value)) return false;
  try {
    const parsed = new URL(value!);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const checkEnv = (
  list: string[],
  label: string,
  severity: RuntimeHealthCheck["severity"] = "error",
): RuntimeHealthCheck => {
  const missing = list.filter((key) => !truthy(process.env[key]));
  return {
    name: `${label} env`,
    ok: missing.length === 0,
    severity,
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
  };
};

const checkConfiguredValues = (
  entries: Array<[string, string | number | undefined | null]>,
  label: string,
  severity: RuntimeHealthCheck["severity"] = "error",
): RuntimeHealthCheck => {
  const missing = entries
    .filter(([, value]) => !truthy(String(value ?? "")))
    .map(([key]) => key);
  return {
    name: `${label} config`,
    ok: missing.length === 0,
    severity,
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
  };
};

const checkBaseUrl = (): RuntimeHealthCheck => {
  const candidates = [
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_APP_URL",
    "APP_URL",
  ].filter((key) => truthy(process.env[key]));

  if (candidates.length === 0) {
    return {
      name: "app base url",
      ok: false,
      severity: "error",
      detail: "missing one of: NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_APP_URL, APP_URL",
    };
  }

  const invalid = candidates.filter((key) => !isAbsoluteHttpUrl(process.env[key]));
  if (invalid.length > 0) {
    return {
      name: "app base url",
      ok: false,
      severity: "error",
      detail: `invalid URL: ${invalid.join(", ")}`,
    };
  }

  const publicUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL;
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && publicUrl?.startsWith("http://")) {
    return {
      name: "app base url",
      ok: false,
      severity: "error",
      detail: "production base URL must use https",
    };
  }

  return { name: "app base url", ok: true, severity: "error" };
};

const checkInicis = (): RuntimeHealthCheck => {
  const mode = resolveInicisMode();
  const suffix = mode === "prod" ? "PROD" : "STG";
  const missing = [
    `INICIS_MID_${suffix}`,
    `INICIS_SIGN_KEY_${suffix}`,
  ].filter((key) => !truthy(process.env[key]));

  if (missing.length > 0) {
    return {
      name: `inicis ${mode} env`,
      ok: false,
      severity: "error",
      detail: `missing: ${missing.join(", ")}`,
    };
  }

  const stdJsUrl =
    mode === "prod"
      ? "https://stdpay.inicis.com/stdjs/INIStdPay.js"
      : process.env[`INICIS_STDJS_URL_${suffix}`] ??
        "https://stgstdpay.inicis.com/stdjs/INIStdPay.js";
  const isProdJs = stdJsUrl.includes("stdpay.inicis.com");
  const isStgJs = stdJsUrl.includes("stgstdpay.inicis.com");
  if (mode === "stg" && isProdJs) {
    return {
      name: `inicis ${mode} env`,
      ok: false,
      severity: "error",
      detail: "stg mode cannot use production STDPay JS URL",
    };
  }
  if (mode === "prod" && isStgJs) {
    return {
      name: `inicis ${mode} env`,
      ok: false,
      severity: "error",
      detail: "prod mode cannot use staging STDPay JS URL",
    };
  }

  return { name: `inicis ${mode} env`, ok: true, severity: "error" };
};

export const runRuntimeConfigChecks = (
  options: RuntimeHealthOptions = {},
): RuntimeHealthCheck[] => {
  const optionalSeverity: RuntimeHealthCheck["severity"] = options.strict
    ? "error"
    : "warning";
  const includeOptionalNotifications =
    options.includeOptionalNotifications ?? Boolean(options.strict);

  const checks: RuntimeHealthCheck[] = [
    checkBaseUrl(),
    checkEnv(
      [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ],
      "supabase",
    ),
    checkEnv(
      [
        "B2_S3_ENDPOINT",
        "B2_REGION",
        "B2_BUCKET",
        "B2_KEY_ID",
        "B2_APPLICATION_KEY",
      ],
      "b2",
    ),
    checkInicis(),
    checkConfiguredValues(
      [
        ["supportEmail", APP_CONFIG.supportEmail],
        ["supportPhone", APP_CONFIG.supportPhone],
        ["bankName", APP_CONFIG.bankName],
        ["bankAccount", APP_CONFIG.bankAccount],
        ["bankHolder", APP_CONFIG.bankHolder],
      ],
      "support and bank",
      optionalSeverity,
    ),
  ];

  if (includeOptionalNotifications) {
    checks.push(
      checkEnv(["RESEND_API_KEY", "RESEND_FROM"], "email", optionalSeverity),
      checkEnv(
        ["KAKAO_ALIMTALK_WEBHOOK_URL"],
        "kakao notification",
        "warning",
      ),
    );
  }

  return checks;
};

export const summarizeRuntimeHealth = (checks: RuntimeHealthCheck[]) => {
  const errors = checks.filter((check) => !check.ok && check.severity === "error");
  const warnings = checks.filter(
    (check) => !check.ok && check.severity === "warning",
  );
  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
  };
};
