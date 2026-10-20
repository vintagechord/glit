import assert from "node:assert/strict";
import test from "node:test";

import { ALBUM_PRICE_CHANGED_MESSAGE, validateAlbumPaymentPricing } from "../src/lib/submission-payment-pricing";

function fixture(overrides: Record<string, unknown> = {}, fail = false) {
  const row = { amount_krw: 100000, album_base_price_krw: 100000, album_price_tier: "FULL", package: { price_krw: 100000 }, ...overrides };
  const query = {
    select() { return query; },
    in() { return query; },
    eq() { return Promise.resolve({ data: fail ? null : [row], error: fail ? { message: "unavailable" } : null }); },
  };
  return { from: () => query } as unknown as Parameters<typeof validateAlbumPaymentPricing>[0];
}

test("fresh full-price album checkout accepts either relation shape", async () => {
  assert.equal(await validateAlbumPaymentPricing(fixture(), ["album"]), null);
  assert.equal(await validateAlbumPaymentPricing(fixture({ package: [{ price_krw: 100000 }] }), ["album"]), null);
});

test("campaign, additional-album and stale-package prices cannot start new orders", async () => {
  for (const row of [
    { amount_krw: 70000, album_base_price_krw: 70000 },
    { amount_krw: 50000, album_price_tier: "ADDITIONAL" },
    { package: { price_krw: 120000 } },
    { package: null },
    { album_base_price_krw: null },
    { album_price_tier: null },
  ]) {
    assert.equal(await validateAlbumPaymentPricing(fixture(row), ["album"]), ALBUM_PRICE_CHANGED_MESSAGE);
  }
});

test("price lookup failure blocks checkout and empty checkout avoids a lookup", async () => {
  assert.match((await validateAlbumPaymentPricing(fixture({}, true), ["album"])) ?? "", /확인하지 못했습니다/);
  const db = { from() { throw new Error("unexpected query"); } } as unknown as Parameters<typeof validateAlbumPaymentPricing>[0];
  assert.equal(await validateAlbumPaymentPricing(db, []), null);
});
