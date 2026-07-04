import assert from "node:assert/strict";
import test from "node:test";

import {
  getAlbumDiscountAmount,
  getAlbumReviewDiscountPercentForPackage,
  getDiscountedAlbumPrice,
} from "../src/lib/album-pricing";

test("album pricing applies configured discount to 3 and 7 station packages", () => {
  assert.equal(getAlbumReviewDiscountPercentForPackage(50, 3), 50);
  assert.equal(getAlbumReviewDiscountPercentForPackage(50, 7), 50);
  assert.equal(getDiscountedAlbumPrice(50000, 50, 3), 25000);
  assert.equal(getDiscountedAlbumPrice(70000, 50, 7), 35000);
  assert.equal(getAlbumDiscountAmount(70000, 50, 7), 35000);
});

test("album pricing applies configured discount to other station packages", () => {
  assert.equal(getAlbumReviewDiscountPercentForPackage(50, 10), 50);
  assert.equal(getAlbumReviewDiscountPercentForPackage(50, 13), 50);
  assert.equal(getDiscountedAlbumPrice(100000, 50, 10), 50000);
  assert.equal(getDiscountedAlbumPrice(130000, 50, 13), 65000);
});
