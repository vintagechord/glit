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

test("device checks cover phones, tablets and iPad desktop mode without blocking desktop", () => {
  for (const ua of mobileAgents) assert.equal(isInicisMobileDevice(ua), true);
  assert.equal(isInicisMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", 5), true);
  assert.equal(isInicisMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", 0), false);
  assert.equal(isInicisMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0"), false);
  assert.equal(isInicisMobileRequest(new Headers({ "sec-ch-ua-mobile": "?1" })), true);
});

test("mobile launch returns actionable guidance before reserving an order or loading the PC SDK", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window"); });
  t.mock.method(globalThis, "fetch", async () => { assert.fail("mobile must not reserve an order"); });
  for (const userAgent of [...mobileAgents, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15"]) {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { navigator: { userAgent, maxTouchPoints: 5 } } });
    const result = await openInicisCardPopup({ context: "music", submissionId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(result.orderId, undefined);
    assert.deepEqual(result, { ok: false, error: INICIS_MOBILE_UNAVAILABLE_MESSAGE });
  }
});

test("mobile calls to card order APIs stop before database or gateway work", async () => {
  for (const handler of [submissionOrder, karaokeOrder]) {
    const response = await handler(new NextRequest("https://onside.test/api/inicis/submission/order", {
      method: "POST", headers: { "user-agent": mobileAgents[0], "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "11111111-1111-4111-8111-111111111111", context: "music" }),
    }));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "MOBILE_CARD_UNAVAILABLE");
    assert.equal(payload.error, INICIS_MOBILE_UNAVAILABLE_MESSAGE);
  }
});
