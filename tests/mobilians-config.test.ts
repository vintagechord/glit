import assert from "node:assert/strict";
import test from "node:test";

import {
  getMobiliansConfig,
  getMobiliansMode,
  getMobiliansSiteUrl,
} from "../src/lib/mobilians/config";

const originalEnv = { ...process.env };

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value as string;
  }
};

const setEnv = (env: Record<string, string | undefined>) => {
  restoreEnv();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

test.afterEach(() => restoreEnv());
test.after(() => restoreEnv());

test("getMobiliansMode respects explicit MOBILIANS_ENV override", () => {
  setEnv({
    MOBILIANS_ENV: "prod",
    MOBILIANS_SID_PROD: "PROD123",
    MOBILIANS_SKEY_PROD: "prod-key",
    MOBILIANS_SID_STG: "STG123",
    MOBILIANS_SKEY_STG: "stg-key",
  });
  assert.equal(getMobiliansMode(), "prod");
});

test("getMobiliansConfig defaults card payments to the production API", () => {
  setEnv({
    MOBILIANS_ENV: "prod",
    MOBILIANS_SID_PROD: "PROD123",
    MOBILIANS_SKEY_PROD: "prod-key",
    MOBILIANS_CASH_CODE: "cn",
  });

  const config = getMobiliansConfig();
  assert.equal(config.env, "prod");
  assert.equal(config.cashCode, "CN");
  assert.equal(config.apiBaseUrl, "https://mup.mobilians.co.kr");
});

test("getMobiliansConfig rejects CN/card payments on the staging API", () => {
  setEnv({
    MOBILIANS_ENV: "stg",
    MOBILIANS_SID_STG: "STG123",
    MOBILIANS_SKEY_STG: "stg-key",
    MOBILIANS_CASH_CODE: "CN",
    MOBILIANS_ALLOW_STG_CARD: undefined,
  });

  assert.throws(
    () => getMobiliansConfig(),
    /Credit card service is not available on the test server/,
  );
});

test("getMobiliansConfig still allows non-card staging credentials", () => {
  setEnv({
    MOBILIANS_ENV: "stg",
    MOBILIANS_SID_STG: "STG123",
    MOBILIANS_SKEY_STG: "stg-key",
    MOBILIANS_CASH_CODE: "MC",
  });

  const config = getMobiliansConfig();
  assert.equal(config.env, "stg");
  assert.equal(config.cashCode, "MC");
  assert.equal(config.apiBaseUrl, "https://test.mobilians.co.kr");
});

test("getMobiliansSiteUrl normalizes a configured URL to hostname only", () => {
  setEnv({
    MOBILIANS_SITE_URL: "https://onside.co.kr/payments",
  });

  assert.equal(getMobiliansSiteUrl("https://fallback.example.com"), "onside.co.kr");
});
