import assert from "node:assert/strict";
import test from "node:test";

import {
  getAlbumDiscountAmount,
  getAlbumReviewDiscountPercentForPackage,
  getAlbumReviewPriceKrw,
  getDiscountedAlbumPrice,
} from "../src/lib/album-pricing";
import { getAlbumReviewDiscountPercent } from "../src/lib/album-discount-server";

test("all packages ignore stale renewal and additional-album campaign percentages", () => {
  for (const stationCount of [3, 7, 10, 13, 15]) {
    for (const stalePercent of [0, 30, 50, 100, -1, Number.NaN]) {
      const price = stationCount * 10000;
      assert.equal(getAlbumReviewDiscountPercentForPackage(stalePercent, stationCount), 0);
      assert.equal(getDiscountedAlbumPrice(price, stalePercent, stationCount), price);
      assert.equal(getAlbumDiscountAmount(price, stalePercent, stationCount), 0);
    }
  }
});

test("each album in a multi-album quote uses the same original package price", () => {
  assert.equal(getAlbumReviewPriceKrw(70000), 70000);
  assert.equal(getAlbumReviewPriceKrw(70000, 2), 140000);
  assert.equal(getAlbumReviewPriceKrw(70000, 5), 350000);
  assert.equal(getAlbumReviewPriceKrw(100000, 3), 300000);
});

test("quotes normalize whole won and counts and reject non-finite values", () => {
  assert.equal(getAlbumReviewPriceKrw(50000.6, 2.9), 100002);
  assert.equal(getAlbumReviewPriceKrw(-10, 2), 0);
  assert.equal(getAlbumReviewPriceKrw(50000, -2), 0);
  assert.equal(getAlbumReviewPriceKrw(50000, 0), 0);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(getAlbumReviewPriceKrw(value), 0);
    assert.equal(getAlbumReviewPriceKrw(50000, value), 0);
  }
});

test("retired campaign settings cannot reactivate discounts or add a save-time query", async () => {
  const db = {
    from() {
      assert.fail("current pricing must not read the retired campaign setting");
    },
  };
  assert.equal(await getAlbumReviewDiscountPercent(db), 0);
});
