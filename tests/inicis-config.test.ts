import assert from "node:assert/strict";
import test from "node:test";

import { getInicisMode, getStdPayConfig } from "../src/lib/inicis/config";
import { runRuntimeConfigChecks } from "../src/lib/runtime-health";

const originalEnv = { ...process.env };
const inicisEnvKeys = [
  "INICIS_ENV",
  "NEXT_PUBLIC_INICIS_ENV",
  "INICIS_MID_PROD",
  "INICIS_SIGN_KEY_PROD",
  "INICIS_MID_STG",
  "INICIS_SIGN_KEY_STG",
  "INICIS_STDJS_URL_STG",
];

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
  for (const key of inicisEnvKeys) {
    delete process.env[key];
  }
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

test("getInicisMode respects explicit INICIS_ENV override", () => {
  setEnv({
    INICIS_ENV: "stg",
    INICIS_MID_STG: "INIStg",
    INICIS_SIGN_KEY_STG: "sign-stg",
    INICIS_MID_PROD: "",
    INICIS_SIGN_KEY_PROD: "",
  });
  assert.equal(getInicisMode(), "stg");
});

test("getInicisMode falls back to prod when prod credentials exist", () => {
  setEnv({
    INICIS_MID_PROD: "PROD123",
    INICIS_SIGN_KEY_PROD: "prod-sign",
    INICIS_MID_STG: "",
    INICIS_SIGN_KEY_STG: "",
  });
  assert.equal(getInicisMode(), "prod");
});

test("getInicisMode uses stg when only staging credentials exist", () => {
  setEnv({
    INICIS_MID_PROD: "",
    INICIS_SIGN_KEY_PROD: "",
    INICIS_MID_STG: "STG123",
    INICIS_SIGN_KEY_STG: "stg-sign",
  });
  assert.equal(getInicisMode(), "stg");
});

test("staging readiness accepts its exact hostname and agrees with payment config", () => {
  setEnv({ INICIS_ENV: "stg", INICIS_MID_STG: "fixture-mid", INICIS_SIGN_KEY_STG: "fixture-key" });
  assert.equal(getStdPayConfig().stdJsUrl, "https://stgstdpay.inicis.com/stdjs/INIStdPay.js");
  assert.equal(runRuntimeConfigChecks().find((check) => check.name === "inicis stg env")?.ok, true);
  for (const url of [
    "https://stdpay.inicis.com/stdjs/INIStdPay.js",
    "https://stgstdpay.inicis.com.attacker.invalid/INIStdPay.js",
    "https://attacker.invalid/stgstdpay.inicis.com",
    "http://stgstdpay.inicis.com/stdjs/INIStdPay.js",
    "https://private-secret@stgstdpay.inicis.com/stdjs/INIStdPay.js",
  ]) {
    process.env.INICIS_STDJS_URL_STG = url;
    assert.throws(() => getStdPayConfig());
    const check = runRuntimeConfigChecks().find((entry) => entry.name === "inicis stg env");
    assert.equal(check?.ok, false);
    assert.doesNotMatch(JSON.stringify(check), /private-secret|fixture-key|attacker/);
  }
});
