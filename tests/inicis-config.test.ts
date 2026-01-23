import assert from "node:assert/strict";
import test from "node:test";

import { getInicisMode } from "../src/lib/inicis/config";

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
