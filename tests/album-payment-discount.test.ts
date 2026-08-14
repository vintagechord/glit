import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  type AlbumDiscountPaymentItem,
  validateAlbumDiscountPaymentGroup,
} from "../src/lib/album-payment-discount";

const baseItem = (
  overrides: Partial<AlbumDiscountPaymentItem> = {},
): AlbumDiscountPaymentItem => ({
  id: "base",
  userId: "member-1",
  guestToken: null,
  packageId: "package-7",
  isOneClick: false,
  amountKrw: 100_000,
  basePriceKrw: 100_000,
  priceTier: "FULL",
  paymentStatus: "UNPAID",
  ...overrides,
});

const additionalItem = (
  overrides: Partial<AlbumDiscountPaymentItem> = {},
): AlbumDiscountPaymentItem =>
  baseItem({
    id: "additional",
    amountKrw: 50_000,
    priceTier: "ADDITIONAL",
    ...overrides,
  });

const submissionActions = readFileSync(
  new URL("../src/features/submissions/actions.ts", import.meta.url),
  "utf8",
);

test("same-owner full-price album unlocks additional albums in one payment group", () => {
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [baseItem(), additionalItem()],
    }),
    { ok: true },
  );
});

test("discounted album cannot be paid alone without an existing paid base", () => {
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [additionalItem()],
    }),
    {
      ok: false,
      reason: "DISCOUNT_NOT_ELIGIBLE",
      itemId: "additional",
    },
  );
});

test("an existing paid full-price album unlocks a later discounted album", () => {
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [additionalItem()],
      paidItems: [baseItem({ paymentStatus: "PAID" })],
    }),
    { ok: true },
  );
});

test("distinct per-submission guest tokens are allowed inside one verified payment group", () => {
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [
        baseItem({ userId: null, guestToken: "guest-a" }),
        additionalItem({ userId: null, guestToken: "guest-b" }),
      ],
    }),
    { ok: true },
  );
});

test("a guest cannot borrow another guest's historical paid base", () => {
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [
        additionalItem({ userId: null, guestToken: "guest-b" }),
      ],
      paidItems: [
        baseItem({
          userId: null,
          guestToken: "guest-a",
          paymentStatus: "PAID",
        }),
      ],
    }),
    {
      ok: false,
      reason: "DISCOUNT_NOT_ELIGIBLE",
      itemId: "additional",
    },
  );
});

test("package, one-click mode, snapshot price, and amount must match", () => {
  for (const candidate of [
    baseItem({ packageId: "different-package" }),
    baseItem({ isOneClick: true }),
    baseItem({ basePriceKrw: 120_000, amountKrw: 120_000 }),
  ]) {
    assert.equal(
      validateAlbumDiscountPaymentGroup({
        selectedItems: [candidate, additionalItem()],
      }).ok,
      false,
    );
  }

  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [additionalItem({ amountKrw: 49_999 })],
      paidItems: [baseItem({ paymentStatus: "PAID" })],
    }),
    { ok: false, reason: "INVALID_PRICE", itemId: "additional" },
  );
});

test("member provisional discount lookup mirrors the authoritative base shape", () => {
  assert.match(
    submissionActions,
    /hasRecentBaseAlbumForDiscount[\s\S]*\.eq\("type", "ALBUM"\)[\s\S]*\.eq\("is_oneclick", isOneClick\)[\s\S]*\.eq\("album_base_price_krw", basePriceKrw\)[\s\S]*\.eq\("album_price_tier", "FULL"\)/,
  );
  assert.match(
    submissionActions,
    /query\.is\("user_id", null\)\.eq\("guest_token", guestToken\)/,
  );
});
