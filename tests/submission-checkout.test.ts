import assert from "node:assert/strict";
import test from "node:test";
import { buildSubmissionCheckoutHref, parseCheckoutSubmissionIds, prepareOrderCheckout } from "../src/lib/submission-checkout";
import { GUEST_SUBMISSION_CART_STORAGE_KEY, GUEST_SUBMISSION_ORDERS_STORAGE_KEY, readGuestSubmissionCartEntries, readGuestSubmissionOrderEntries } from "../src/lib/guest-submission-cart";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const unrelated = "33333333-3333-4333-8333-333333333333";
const order = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idAt = (index: number) => `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;

function browserFixture() {
  const previous = Reflect.get(globalThis, "window"), fetchBefore = globalThis.fetch;
  const storage = new Map<string, string>(), events: string[] = [];
  let blockedStorage = false;
  Reflect.set(globalThis, "window", {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem(key: string, value: string) { if (blockedStorage) throw new Error("Storage blocked"); storage.set(key, value); } },
    dispatchEvent(event: Event) { events.push(event.type); },
  });
  return {
    storage, events, blockStorage() { blockedStorage = true; },
    restore() {
      globalThis.fetch = fetchBefore;
      if (previous === undefined) Reflect.deleteProperty(globalThis, "window"); else Reflect.set(globalThis, "window", previous);
    },
  };
}

test("checkout links carry only deduplicated UUIDs and retain the locale without silently truncating an oversized group", () => {
  assert.deepEqual(parseCheckoutSubmissionIds(null), []);
  assert.deepEqual(parseCheckoutSubmissionIds("invalid,,"), []);
  assert.deepEqual(parseCheckoutSubmissionIds(` ${order.toUpperCase()},${first},invalid,${order}`), [order, first]);
  assert.deepEqual(parseCheckoutSubmissionIds(Array.from({ length: 101 }, (_, i) => idAt(i)).join(",")), []);
  assert.equal(parseCheckoutSubmissionIds(Array.from({ length: 100 }, (_, i) => idAt(i)).join(",")).length, 100);
  assert.equal(buildSubmissionCheckoutHref([first, second, first], "/en"), `/en/mypage/cart?step=payment&items=${encodeURIComponent(`${first},${second}`)}`);
  assert.throws(() => buildSubmissionCheckoutHref([]), /결제할 신청서/);
  assert.throws(() => buildSubmissionCheckoutHref(["https://foreign.invalid"]), /결제할 신청서/);
});

test("member checkout preparation makes one guarded return request and selects exactly its returned order items", async () => {
  const fixture = browserFixture();
  const calls: string[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      assert.deepEqual(JSON.parse(init?.body as string), { orderId: order, guestTokensBySubmissionId: {} });
      return Response.json({ ok: true, submissionIds: [first, second] });
    };
    assert.deepEqual(await prepareOrderCheckout({ orderId: order, guestTokensBySubmissionId: {} }), {
      href: `/mypage/cart?step=payment&items=${encodeURIComponent(`${first},${second}`)}`, submissionIds: [first, second],
    });
    assert.deepEqual(calls, ["/api/orders/return"]);
    assert.deepEqual(fixture.events, ["onside:cart-updated", "onside:orders-updated"]);
    assert.equal(fixture.storage.size, 0);
  } finally { fixture.restore(); }
});

test("guest preparation stores only returned credentials and preserves unrelated previous order proof without putting tokens in links", async () => {
  const fixture = browserFixture();
  try {
    fixture.storage.set(GUEST_SUBMISSION_ORDERS_STORAGE_KEY, JSON.stringify([{ submissionId: unrelated, guestToken: "unrelated-private-proof" }]));
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "/api/orders/return");
      assert.doesNotMatch(String(url), /private-proof/);
      assert.deepEqual(JSON.parse(init?.body as string).guestTokensBySubmissionId, { [first]: "first-private-proof", [second]: "second-private-proof", [unrelated]: "unrelated-private-proof" });
      return Response.json({ ok: true, submissionIds: [first, second] });
    };
    const prepared = await prepareOrderCheckout({ orderId: order, guestTokensBySubmissionId: { [first]: "first-private-proof", [second]: "second-private-proof", [unrelated]: "unrelated-private-proof" }, localePrefix: "/en" });
    assert.doesNotMatch(prepared.href, /private-proof/);
    assert.deepEqual(readGuestSubmissionCartEntries().map(entry => entry.submissionId), [first, second]);
    assert.deepEqual(readGuestSubmissionOrderEntries().map(entry => entry.submissionId), [unrelated, first, second]);
    assert.ok(fixture.events.includes("onside:cart-updated") && fixture.events.includes("onside:orders-updated"));
  } finally { fixture.restore(); }
});

test("uncertain or changed orders and malformed responses never publish checkout state or automatically retry", async () => {
  const fixture = browserFixture();
  let calls = 0;
  try {
    for (const status of [401, 403, 409, 429, 500]) {
      globalThis.fetch = async () => { calls++; return Response.json({ error: "private-provider-error" }, { status }); };
      const before = calls;
      await assert.rejects(prepareOrderCheckout({ orderId: order, guestTokensBySubmissionId: {} }), error => {
        assert.doesNotMatch(String(error), /private-provider-error/);
        return true;
      });
      assert.equal(calls, before + 1);
    }
    for (const body of [null, [], { ok: false, submissionIds: [first] }, { ok: true, submissionIds: [] }, { ok: true, submissionIds: [first, "wrong-id"] }, { ok: true, submissionIds: Array.from({ length: 101 }, (_, i) => idAt(i)) }]) {
      globalThis.fetch = async () => { calls++; return Response.json(body); };
      const before = calls;
      await assert.rejects(prepareOrderCheckout({ orderId: order, guestTokensBySubmissionId: {} }), /주문 정보|주문내역/);
      assert.equal(calls, before + 1);
    }
    globalThis.fetch = async () => { calls++; throw new TypeError("private-transport-error"); };
    const before = calls;
    await assert.rejects(prepareOrderCheckout({ orderId: order, guestTokensBySubmissionId: {} }), /응답을 확인하지 못했습니다/);
    assert.equal(calls, before + 1);
    assert.deepEqual(fixture.events, []);
    assert.equal(fixture.storage.size, 0);
  } finally { fixture.restore(); }
});

test("invalid or oversized proof sets are refused before any request, and storage failure is visible after a successful return", async () => {
  const fixture = browserFixture();
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ ok: true, submissionIds: [first] }); };
    for (const input of [
      { orderId: "invalid", guestTokensBySubmissionId: {} },
      { orderId: order, guestTokensBySubmissionId: { [first]: "short" } },
      { orderId: order, guestTokensBySubmissionId: { [first]: "private-proof\n" } },
      { orderId: order, guestTokensBySubmissionId: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [idAt(i), "private-proof"])) },
    ]) await assert.rejects(prepareOrderCheckout(input), /조회 정보/);
    assert.equal(calls, 0);
    fixture.blockStorage();
    await assert.rejects(prepareOrderCheckout({ orderId: order, guestTokensBySubmissionId: { [first]: "private-proof" } }), /이 브라우저에 저장하지 못했습니다/);
    assert.equal(calls, 1);
    assert.equal(fixture.storage.has(GUEST_SUBMISSION_CART_STORAGE_KEY), false);
  } finally { fixture.restore(); }
});
