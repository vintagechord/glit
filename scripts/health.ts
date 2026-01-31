#!/usr/bin/env tsx
/**
 * Lightweight environment and API contract health checks.
 * - Validates presence/consistency of required env vars for Supabase, B2, and Inicis.
 * - Fails with non-zero exit code on missing/invalid configuration.
 *
 * Run via: npm run health
 */

import process from "node:process";

type Check = { name: string; ok: boolean; detail?: string };

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const b2Env = [
  "B2_S3_ENDPOINT",
  "B2_REGION",
  "B2_BUCKET",
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
];

const inicisProd = [
  "INICIS_MID_PROD",
  "INICIS_SIGN_KEY_PROD",
  "INICIS_BILLING_API_KEY_PROD",
  "INICIS_BILLING_API_IV_PROD",
  "INICIS_LITE_KEY_PROD",
  "INICIS_API_URL_PROD",
];

const inicisStg = [
  "INICIS_MID_STG",
  "INICIS_SIGN_KEY_STG",
  "INICIS_BILLING_API_KEY_STG",
  "INICIS_BILLING_API_IV_STG",
  "INICIS_LITE_KEY_STG",
  "INICIS_API_URL_STG",
];

const truthy = (value: string | undefined | null) =>
  Boolean(value && value.trim().length > 0);

function checkEnv(list: string[], label: string): Check {
  const missing = list.filter((key) => !truthy(process.env[key]));
  return {
    name: `${label} env`,
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
  };
}

function runChecks(): Check[] {
  const mode = (process.env.INICIS_ENV ?? process.env.NEXT_PUBLIC_INICIS_ENV ?? "").toLowerCase();
  const useProd =
    mode === "prod" || mode === "production" || (!mode && truthy(process.env.INICIS_MID_PROD));

  const checks: Check[] = [];
  checks.push(checkEnv(requiredEnv, "supabase"));
  checks.push(checkEnv(b2Env, "b2"));
  checks.push(checkEnv(useProd ? inicisProd : inicisStg, `inicis ${useProd ? "prod" : "stg"}`));
  return checks;
}

const checks = runChecks();
const failed = checks.filter((c) => !c.ok);

checks.forEach((c) => {
  if (c.ok) {
    console.log(`✅ ${c.name}`);
  } else {
    console.error(`❌ ${c.name}: ${c.detail}`);
  }
});

if (failed.length) {
  process.exitCode = 1;
  console.error(`\nHealth failed (${failed.length} issue${failed.length > 1 ? "s" : ""}).`);
} else {
  console.log("\nAll required configuration is present.");
}
