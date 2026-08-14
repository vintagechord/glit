import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getStoredInicisCallbackState,
  verifyInicisCallbackState,
} from "../src/lib/inicis/callback-state";
import { buildStdPayRequest } from "../src/lib/inicis/stdpay";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const returnHandler = read("../src/app/api/inicis/return/handler.ts");
const stdPay = read("../src/lib/inicis/stdpay.ts");
const submissionPayment = read("../src/lib/payments/submission.ts");
const karaokePayment = read("../src/lib/payments/karaoke.ts");
const closeRoute = read("../src/app/api/inicis/close/route.ts");

const state = "01234567-89ab-4cde-8fab-0123456789ab";

test("Inicis callback state requires an exact order-bound match", () => {
  assert.equal(getStoredInicisCallbackState({ closeState: state }), state);
  assert.equal(getStoredInicisCallbackState({ closeState: 123 }), null);
  assert.equal(getStoredInicisCallbackState(null), null);

  assert.equal(
    verifyInicisCallbackState({ storedState: state, receivedState: state }),
    true,
  );
  assert.equal(
    verifyInicisCallbackState({
      storedState: state,
      receivedState: `${state.slice(0, -1)}c`,
    }),
    false,
  );
  assert.equal(
    verifyInicisCallbackState({
      storedState: state,
      receivedState: ` ${state} `,
    }),
    false,
  );
  assert.equal(
    verifyInicisCallbackState({ storedState: "too-short", receivedState: "too-short" }),
    false,
  );
});

test("submission and karaoke STDPay requests send their stored close state as merchantData", () => {
  assert.match(stdPay, /merchantData\?: string/);
  assert.match(
    stdPay,
    /const merchantData = billing\?\.callbackState \?\? params\.merchantData\?\.trim\(\)/,
  );
  assert.match(stdPay, /\.\.\.\(merchantData \? \{ merchantData \} : \{\}\)/);
  assert.match(
    submissionPayment,
    /const closeState = randomUUID\(\)[\s\S]*buildStdPayRequest\(\{[\s\S]*merchantData: closeState[\s\S]*p_raw_response: \{ paymentGroup, closeState \}/,
  );
  assert.match(
    karaokePayment,
    /const closeState = randomUUID\(\)[\s\S]*buildStdPayRequest\([\s\S]*merchantData: closeState[\s\S]*raw_response: \{ closeState \}/,
  );
});

test("STDPay runtime payload preserves the exact callback state", () => {
  const original = {
    INICIS_ENV: process.env.INICIS_ENV,
    NEXT_PUBLIC_INICIS_ENV: process.env.NEXT_PUBLIC_INICIS_ENV,
    INICIS_MID_STG: process.env.INICIS_MID_STG,
    INICIS_SIGN_KEY_STG: process.env.INICIS_SIGN_KEY_STG,
    INICIS_STDJS_URL_STG: process.env.INICIS_STDJS_URL_STG,
  };
  process.env.INICIS_ENV = "stg";
  delete process.env.NEXT_PUBLIC_INICIS_ENV;
  process.env.INICIS_MID_STG = "test-mid";
  process.env.INICIS_SIGN_KEY_STG = "test-sign-key-with-sufficient-entropy";
  process.env.INICIS_STDJS_URL_STG =
    "https://stgstdpay.inicis.com/stdjs/INIStdPay.js";

  try {
    const payload = buildStdPayRequest(
      {
        orderId: "SUBP-2000000000000-12345678-abcdef12",
        amountKrw: 39_000,
        productName: "Onside review",
        buyerName: "Guest",
        returnUrl: "https://onside.example/api/inicis/return",
        closeUrl: "https://onside.example/api/inicis/close",
        merchantData: state,
      },
      "2000000000000",
    );
    assert.equal(payload.merchantData, state);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("unauthenticated early return failures cannot mutate payment state", () => {
  const verifyIndex = returnHandler.indexOf(
    "const callbackStateVerified = verifyInicisCallbackState",
  );
  const saveFailureIndex = returnHandler.indexOf("const saveFailure = async");
  const stateGuardIndex = returnHandler.indexOf(
    "if (!callbackStateVerified)",
    saveFailureIndex,
  );
  const submissionFailureWrite = returnHandler.indexOf(
    "await markPaymentFailure",
    saveFailureIndex,
  );
  const karaokeFailureWrite = returnHandler.indexOf(
    "await markKaraokePaymentFailure",
    saveFailureIndex,
  );

  assert.ok(verifyIndex >= 0);
  assert.ok(saveFailureIndex > verifyIndex);
  assert.ok(stateGuardIndex > saveFailureIndex);
  assert.ok(submissionFailureWrite > stateGuardIndex);
  assert.ok(karaokeFailureWrite > stateGuardIndex);
  assert.match(
    returnHandler.slice(stateGuardIndex, submissionFailureWrite),
    /return;/,
  );
  assert.match(
    returnHandler,
    /params\.merchantData \?\? params\.merchantdata/,
  );
  assert.match(
    returnHandler,
    /params\.merchantData \?\? params\.merchantdata \?\? ""/,
  );
  assert.match(
    returnHandler,
    /const shouldSucceed = approval\.ok && authSuccess && Boolean\(tid\)/,
  );
  assert.match(closeRoute, /searchParams\.get\("state"\) \?\? ""/);
  assert.doesNotMatch(closeRoute, /searchParams\.get\("state"\)\?\.trim/);
  assert.match(submissionPayment, /payload\?\.close_state \?\? ""/);
  assert.match(karaokePayment, /payload\?\.close_state \?\? ""/);
});
