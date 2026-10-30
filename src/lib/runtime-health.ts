import { APP_CONFIG } from "./config";
import { getEmailDeliveryConfiguration } from "./email-config";
import { getInicisMode, getStdPayConfig, isInicisMobileCardConfigured } from "./inicis/config";
import { getKakaoConfiguration } from "./kakao-config";
import { checkSupabaseConfig } from "./supabase/health";

export type RuntimeHealthCheck = {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  detail?: string;
};

type RuntimeHealthOptions = {
  strict?: boolean;
  includeOptionalNotifications?: boolean;
};

const truthy = (value: string | undefined | null) =>
  Boolean(value && value.trim().length > 0);

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

const checkEmail = (
  severity: RuntimeHealthCheck["severity"] = "error",
): RuntimeHealthCheck => {
  const config = getEmailDeliveryConfiguration();

  if (config.mode === "manual") {
    return {
      name: "email delivery deferred",
      ok: false,
      severity: "warning",
      detail: config.diagnostic,
    };
  }
  if (config.mode === "invalid") {
    return {
      name: "email delivery mode",
      ok: false,
      severity: "error",
      detail: config.diagnostic,
    };
  }

  return {
    name: "email env",
    ok: config.ok,
    severity,
    detail: config.diagnostic,
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
  const mode = getInicisMode();
  try {
    getStdPayConfig();
  } catch (error) {
    return {
      name: `inicis ${mode} env`,
      ok: false,
      severity: "error",
      detail: error instanceof Error ? error.message : "Invalid STDPay configuration.",
    };
  }

  return { name: `inicis ${mode} env`, ok: true, severity: "error" };
};

// Mobile card payment needs the merchant's INIpayMobile hash key. Without it
// the checkout keeps offering bank transfer on phones, so this is a warning.
const checkInicisMobile = (): RuntimeHealthCheck => ({
  name: `inicis ${getInicisMode()} mobile env`,
  ok: isInicisMobileCardConfigured(),
  severity: "warning",
  detail: isInicisMobileCardConfigured() ? undefined : "missing: INICIS_MOBILE_HASH_KEY (mobile card payment disabled)",
});

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
    checkSupabaseConfig(),
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
    checkInicisMobile(),
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
    const kakao = getKakaoConfiguration();
    checks.push(
      // Transactional delivery requires working email. An explicit manual mode
      // stays visible as a warning while all unrelated readiness checks remain.
      checkEmail("error"),
      {
        name: "kakao notification env",
        ok: kakao.ok,
        severity: "warning",
        detail: kakao.ok ? undefined : kakao.diagnostic,
      },
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
