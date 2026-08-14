import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as createPayPalOrder } from "../src/app/api/paypal/orders/route";
import {
  GET as capturePayPalReturn,
  POST as capturePayPalOrder,
} from "../src/app/api/paypal/capture/route";
import { POST as createInicisOrder } from "../src/app/api/inicis/submission/order/route";
import { POST as createKaraokeOrder } from "../src/app/api/inicis/karaoke/order/route";
import {
  GET as rejectInicisReturnGet,
  POST as handleInicisReturn,
} from "../src/app/api/inicis/return/route";
import {
  GET as rejectLegacySubmissionReturnGet,
} from "../src/app/api/inicis/submission/key-return/route";
import { POST as handleSubscriptionKeyReturn } from "../src/app/api/inicis/key-return/route";
import { POST as handleSubscriptionMobileReturn } from "../src/app/api/inicis/mobile-return/route";
import {
  arePublicDevPagesEnabled,
  areServerDevToolsEnabled,
} from "../src/lib/dev-tools";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const validSubmissionId = "11111111-1111-4111-8111-111111111111";
const validReturnState = "22222222-2222-4222-8222-222222222222";

test("payment JSON routes use bounded parsing before gateway or database work", () => {
  for (const path of [
    "../src/app/api/paypal/orders/route.ts",
    "../src/app/api/paypal/capture/route.ts",
    "../src/app/api/inicis/submission/order/route.ts",
    "../src/app/api/inicis/karaoke/order/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /readBoundedJsonBody/);
    assert.doesNotMatch(source, /(?:req|request)\.json\(/);
    assert.match(source, /reason === "too_large" \? 413 : 400/);
  }
});

test("gateway payment routes enforce IP and order-scoped rate limits", () => {
  for (const path of [
    "../src/app/api/paypal/orders/route.ts",
    "../src/app/api/paypal/capture/route.ts",
    "../src/app/api/inicis/submission/order/route.ts",
    "../src/app/api/inicis/karaoke/order/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /consumeRateLimit/);
    assert.match(source, /getRequestIdentifier/);
    assert.match(source, /"Retry-After"/);
    assert.match(source, /15 \* 60 \* 1_000/);
  }
});

test("payment rate limiting returns 429 with Retry-After before side effects", async () => {
  const identifier = `payment-test-${Date.now()}-${Math.random()}`;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    response = await createPayPalOrder(
      new Request("https://example.test/api/paypal/orders", {
        method: "POST",
        headers: { "x-real-ip": identifier },
        body: "{}",
      }),
    );
  }
  assert.equal(response?.status, 429);
  assert.match(response?.headers.get("Retry-After") ?? "", /^\d+$/);
});

test("payment result and subscription callback URLs use the canonical origin", () => {
  const paypalCapture = read("../src/app/api/paypal/capture/route.ts");
  const subscriptionPage = read("../src/app/subscription/page.tsx");
  assert.match(paypalCapture, /getBaseUrl\(\)/);
  assert.doesNotMatch(
    paypalCapture.match(/const redirectToStatus[\s\S]*?\n\};/)?.[0] ?? "",
    /req\.url/,
  );
  assert.match(subscriptionPage, /const baseUrl = getBaseUrl\(\)/);
  assert.doesNotMatch(subscriptionPage, /resolveBaseUrl|from "next\/headers"/);
});

test("payment JSON routes reject oversized bodies before side effects", async () => {
  const oversizedBody = JSON.stringify({ padding: "x".repeat(40 * 1024) });
  const requests = [
    createPayPalOrder(
      new Request("https://example.test/api/paypal/orders", {
        method: "POST",
        body: oversizedBody,
      }),
    ),
    capturePayPalOrder(
      new Request("https://example.test/api/paypal/capture", {
        method: "POST",
        body: oversizedBody,
      }),
    ),
    createInicisOrder(
      new NextRequest("https://example.test/api/inicis/submission/order", {
        method: "POST",
        body: oversizedBody,
      }),
    ),
    createKaraokeOrder(
      new NextRequest("https://example.test/api/inicis/karaoke/order", {
        method: "POST",
        body: oversizedBody,
      }),
    ),
  ];

  const responses = await Promise.all(requests);
  assert.deepEqual(
    responses.map((response) => response.status),
    [413, 413, 413, 413],
  );
});

test("payment routes reject malformed IDs, tokens, states, and oversized guest maps", async () => {
  const invalidOrder = await createPayPalOrder(
    new Request("https://example.test/api/paypal/orders", {
      method: "POST",
      body: JSON.stringify({ submissionId: "not-a-uuid" }),
    }),
  );
  assert.equal(invalidOrder.status, 400);

  const invalidCapture = await capturePayPalOrder(
    new Request("https://example.test/api/paypal/capture", {
      method: "POST",
      body: JSON.stringify({
        orderId: "x".repeat(129),
        submissionId: validSubmissionId,
      }),
    }),
  );
  assert.equal(invalidCapture.status, 400);

  const invalidGuestToken = await createPayPalOrder(
    new Request("https://example.test/api/paypal/orders", {
      method: "POST",
      body: JSON.stringify({
        submissionId: validSubmissionId,
        guestToken: " padded-token ",
      }),
    }),
  );
  assert.equal(invalidGuestToken.status, 400);

  const guestTokensBySubmissionId = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      validReturnState,
    ]),
  );
  const oversizedGuestMap = await createInicisOrder(
    new NextRequest("https://example.test/api/inicis/submission/order", {
      method: "POST",
      body: JSON.stringify({
        submissionId: validSubmissionId,
        guestTokensBySubmissionId,
        context: "music",
      }),
    }),
  );
  assert.equal(oversizedGuestMap.status, 400);

  const invalidReturn = await capturePayPalReturn(
    new Request(
      `https://example.test/api/paypal/capture?submissionId=${validSubmissionId}&state=${validReturnState}&token=${"x".repeat(129)}`,
    ),
  );
  assert.ok(invalidReturn.status >= 300 && invalidReturn.status < 400);
  assert.match(invalidReturn.headers.get("location") ?? "", /payment=failed/);

  const invalidKaraoke = await createKaraokeOrder(
    new NextRequest("https://example.test/api/inicis/karaoke/order", {
      method: "POST",
      body: JSON.stringify({ requestId: "not-a-uuid", context: "karaoke" }),
    }),
  );
  assert.equal(invalidKaraoke.status, 400);
});

test("Inicis public callbacks reject oversized bodies before any mutation", async () => {
  const oversizedForm = new URLSearchParams({
    oid: "ORDER-1",
    authToken: "x".repeat(70 * 1024),
  }).toString();
  const makeRequest = (path: string) =>
    new NextRequest(`https://example.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: oversizedForm,
    });

  const responses = await Promise.all([
    handleInicisReturn(makeRequest("/api/inicis/return")),
    handleSubscriptionKeyReturn(makeRequest("/api/inicis/key-return")),
    handleSubscriptionMobileReturn(makeRequest("/api/inicis/mobile-return")),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [413, 413, 413],
  );

  const oversizedQuery = await handleInicisReturn(
    new NextRequest(
      `https://example.test/api/inicis/return?oid=${"x".repeat(17 * 1024)}`,
    ),
  );
  assert.equal(oversizedQuery.status, 413);
});

test("submission approval callbacks reject state-changing GET requests", async () => {
  const responses = await Promise.all([
    rejectInicisReturnGet(),
    rejectLegacySubmissionReturnGet(),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [405, 405],
  );
  for (const response of responses) {
    assert.equal(response.headers.get("Allow"), "POST");
  }
});

test("production Inicis callbacks have bounded form parsing and dev callback gates first", () => {
  for (const path of [
    "../src/app/api/inicis/return/handler.ts",
    "../src/app/api/inicis/key-return/route.ts",
    "../src/app/api/inicis/mobile-return/route.ts",
  ]) {
    const source = read(path);
    assert.match(
      source,
      /readBoundedInicisCallbackForm|validateInicisCallbackQuery/,
    );
    assert.doesNotMatch(source, /req\.formData\(/);
  }

  const devCallback = read(
    "../src/app/api/inicis/test-100/return/route.ts",
  );
  const gateIndex = devCallback.indexOf("if (!areServerDevToolsEnabled())");
  const parseIndex = devCallback.indexOf("readBoundedInicisCallbackForm(req)");
  assert.ok(gateIndex >= 0 && parseIndex > gateIndex);
  assert.doesNotMatch(devCallback, /req\.formData\(/);
});

test("payment dev tools stay disabled in production despite opt-in flags", () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const original = {
    nodeEnv: process.env.NODE_ENV,
    server: process.env.INICIS_DEV_TOOLS,
    generic: process.env.ENABLE_DEV_TOOLS,
    publicPages: process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES,
  };
  try {
    mutableEnv.NODE_ENV = "production";
    process.env.INICIS_DEV_TOOLS = "1";
    process.env.ENABLE_DEV_TOOLS = "1";
    process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES = "1";
    assert.equal(areServerDevToolsEnabled(), false);
    assert.equal(arePublicDevPagesEnabled(), false);

    mutableEnv.NODE_ENV = "test";
    delete process.env.INICIS_DEV_TOOLS;
    delete process.env.ENABLE_DEV_TOOLS;
    delete process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES;
    assert.equal(areServerDevToolsEnabled(), false);
    assert.equal(arePublicDevPagesEnabled(), false);
    process.env.INICIS_DEV_TOOLS = "1";
    process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES = "1";
    assert.equal(areServerDevToolsEnabled(), true);
    assert.equal(arePublicDevPagesEnabled(), true);
  } finally {
    if (original.nodeEnv === undefined) Reflect.deleteProperty(mutableEnv, "NODE_ENV");
    else mutableEnv.NODE_ENV = original.nodeEnv;
    if (original.server === undefined) delete process.env.INICIS_DEV_TOOLS;
    else process.env.INICIS_DEV_TOOLS = original.server;
    if (original.generic === undefined) delete process.env.ENABLE_DEV_TOOLS;
    else process.env.ENABLE_DEV_TOOLS = original.generic;
    if (original.publicPages === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES;
    } else {
      process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES = original.publicPages;
    }
  }
});
