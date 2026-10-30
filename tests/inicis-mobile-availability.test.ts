import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as submissionOrder } from "../src/app/api/inicis/submission/order/route";
import { POST as karaokeOrder } from "../src/app/api/inicis/karaoke/order/route";
import { openInicisCardPopup } from "../src/lib/inicis/popup";
import { isInicisMobileDevice, isInicisMobileRequest, INICIS_MOBILE_UNAVAILABLE_MESSAGE } from "../src/lib/inicis/device";

const mobileAgents = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148",
];
const SUBMISSION = "11111111-1111-4111-8111-111111111111";

type FakeElement = {
  id?: string; method?: string; action?: string; acceptCharset?: string; target?: string;
  type?: string; name?: string; value?: string; style: Record<string, string>;
  children: FakeElement[]; appendChild: (child: FakeElement) => void; submit: () => void; remove: () => void;
};

const installWindow = (userAgent: string) => {
  const submitted: FakeElement[] = [];
  const element = (): FakeElement => {
    const node: FakeElement = {
      style: {}, children: [],
      appendChild: (child) => { node.children.push(child); },
      submit: () => { submitted.push(node); },
      remove: () => undefined,
    };
    return node;
  };
  const body = element();
  const documentLike = {
    getElementById: () => null,
    createElement: () => element(),
    querySelectorAll: () => [],
    querySelector: () => null,
    body: { ...body, style: { removeProperty: () => undefined } },
    documentElement: { style: { removeProperty: () => undefined } },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { navigator: { userAgent, maxTouchPoints: 5 }, location: { pathname: "/mypage/cart", origin: "https://onside.test" }, sessionStorage: { setItem: () => undefined, getItem: () => null }, localStorage: { setItem: () => undefined, getItem: () => null }, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentLike });
  return { submitted, body };
};

const restoreGlobals = (t: { after: (fn: () => void) => void }) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window");
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else Reflect.deleteProperty(globalThis, "document");
  });
};

test("device checks cover phones, tablets and iPad desktop mode without blocking desktop", () => {
  for (const ua of mobileAgents) assert.equal(isInicisMobileDevice(ua), true);
  assert.equal(isInicisMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", 5), true);
  assert.equal(isInicisMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", 0), false);
  assert.equal(isInicisMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0"), false);
  assert.equal(isInicisMobileRequest(new Headers({ "sec-ch-ua-mobile": "?1" })), true);
});

test("mobile submission checkout asks the server for the INIpayMobile channel and relays an unavailable answer", async (t) => {
  restoreGlobals(t);
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ error: INICIS_MOBILE_UNAVAILABLE_MESSAGE, code: "MOBILE_CARD_UNAVAILABLE" }), { status: 409, headers: { "content-type": "application/json" } });
  });
  for (const userAgent of mobileAgents) {
    installWindow(userAgent);
    const result = await openInicisCardPopup({ context: "music", submissionId: SUBMISSION });
    assert.deepEqual(result, { ok: false, error: INICIS_MOBILE_UNAVAILABLE_MESSAGE });
  }
  assert.equal(requests.length, mobileAgents.length);
  for (const request of requests) {
    assert.equal(request.url, "/api/inicis/submission/order");
    assert.equal(request.body.channel, "mobile");
    assert.equal(request.body.locale, "ko");
  }
});

test("mobile karaoke payment still stops before reserving an order", async (t) => {
  restoreGlobals(t);
  t.mock.method(globalThis, "fetch", async () => { assert.fail("karaoke has no mobile flow and must not reserve an order"); });
  installWindow(mobileAgents[0]);
  const result = await openInicisCardPopup({ context: "karaoke", requestId: SUBMISSION });
  assert.deepEqual(result, { ok: false, error: INICIS_MOBILE_UNAVAILABLE_MESSAGE });
});

test("a configured mobile channel submits a top-level EUC-KR form to the gateway", async (t) => {
  restoreGlobals(t);
  const init = {
    orderId: "SUBP-1761900000000-11111111-abcdef12", channel: "mobile",
    mobile: { actionUrl: "https://mobile.inicis.com/smart/payment/", params: { P_INI_PAYMENT: "CARD", P_MID: "mid", P_OID: "SUBP-1761900000000-11111111-abcdef12", P_AMT: "49000" } },
    closeUrl: "https://onside.test/api/inicis/close?oid=x&state=0f7b2f6e-7f41-4c2a-9c3e-3b2a1d4e5f60&cancel=1",
  };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(init), { status: 200, headers: { "content-type": "application/json" } }));
  const { submitted } = installWindow(mobileAgents[1]);
  const result = await openInicisCardPopup({ context: "music", submissionId: SUBMISSION, guestToken: "guest-fixture-token" });
  assert.deepEqual(result, { ok: true, orderId: init.orderId, redirected: true });
  assert.equal(submitted.length, 1);
  const form = submitted[0];
  assert.equal(form.method, "post");
  assert.equal(form.action, "https://mobile.inicis.com/smart/payment/");
  assert.equal(form.acceptCharset, "EUC-KR");
  assert.equal(form.target, "_self");
  assert.deepEqual(Object.fromEntries(form.children.map((input) => [input.name, input.value])), init.mobile.params);
});

test("mobile calls to card order APIs stop before database or gateway work until the hash key exists", async () => {
  const previous = process.env.INICIS_MOBILE_HASH_KEY_PROD;
  delete process.env.INICIS_MOBILE_HASH_KEY_PROD;
  delete process.env.INICIS_MOBILE_HASH_KEY_STG;
  try {
    const response = await submissionOrder(new NextRequest("https://onside.test/api/inicis/submission/order", {
      method: "POST", headers: { "user-agent": mobileAgents[0], "content-type": "application/json" },
      body: JSON.stringify({ submissionId: SUBMISSION, context: "music" }),
    }));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "MOBILE_CARD_UNAVAILABLE");
    assert.equal(payload.error, INICIS_MOBILE_UNAVAILABLE_MESSAGE);
    const explicit = await submissionOrder(new NextRequest("https://onside.test/api/inicis/submission/order", {
      method: "POST", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0", "content-type": "application/json" },
      body: JSON.stringify({ submissionId: SUBMISSION, context: "music", channel: "mobile" }),
    }));
    assert.equal(explicit.status, 409);
  } finally {
    if (previous !== undefined) process.env.INICIS_MOBILE_HASH_KEY_PROD = previous;
  }
  const karaoke = await karaokeOrder(new NextRequest("https://onside.test/api/inicis/karaoke/order", {
    method: "POST", headers: { "user-agent": mobileAgents[0], "content-type": "application/json" },
    body: JSON.stringify({ requestId: SUBMISSION, context: "karaoke" }),
  }));
  assert.equal(karaoke.status, 409);
  assert.equal((await karaoke.json()).code, "MOBILE_CARD_UNAVAILABLE");
});
