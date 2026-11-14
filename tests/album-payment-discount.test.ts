import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADDITIONAL_ALBUM_DISCOUNT_PERCENT,
  type AlbumDiscountPaymentItem,
  getAdditionalAlbumPriceKrw,
  quoteAlbumBundle,
  quoteAlbumOrder,
  validateAlbumDiscountPaymentGroup,
} from "../src/lib/album-payment-discount";
import { quoteSubmissionCart } from "../src/lib/submission-cart-quote";

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

test("the owner's examples: two albums cost 1.5 and three cost 2 package prices", () => {
  assert.equal(quoteAlbumBundle(100_000, 1).totalKrw, 100_000);
  assert.equal(quoteAlbumBundle(100_000, 2).totalKrw, 150_000);
  assert.equal(quoteAlbumBundle(100_000, 3).totalKrw, 200_000);
  assert.deepEqual(
    (({ albumCount, listTotalKrw, discountTotalKrw, totalKrw }) => ({ albumCount, listTotalKrw, discountTotalKrw, totalKrw }))(
      quoteAlbumBundle(70_000, 4),
    ),
    { albumCount: 4, listTotalKrw: 280_000, discountTotalKrw: 105_000, totalKrw: 175_000 },
  );
  assert.equal(ADDITIONAL_ALBUM_DISCOUNT_PERCENT, 50);
  assert.equal(getAdditionalAlbumPriceKrw(55_001), 27_501);
});

test("a single album, no album and unusable counts are never discounted", () => {
  for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(quoteAlbumBundle(100_000, count).totalKrw, 0);
  }
  assert.equal(quoteAlbumBundle(100_000, 1).discountTotalKrw, 0);
  assert.equal(quoteAlbumBundle(0, 3).totalKrw, 0);
  assert.equal(quoteAlbumOrder([]).totalKrw, 0);
  // An album without a usable list price stays out of the quote.
  assert.deepEqual(
    quoteAlbumOrder([
      { id: "a", basePriceKrw: 100_000 },
      { id: "b", basePriceKrw: null },
      { id: "c", basePriceKrw: Number.NaN },
    ]).lines.map((line) => [line.id, line.tier, line.amountKrw]),
    [["a", "FULL", 100_000]],
  );
});

test("different packages: the dearest album is full price and each other album is half of its own", () => {
  const quote = quoteAlbumOrder([
    { id: "cheap", basePriceKrw: 50_000, createdAt: "2026-11-14T08:00:00+09:00" },
    { id: "dear", basePriceKrw: 150_000, createdAt: "2026-11-14T09:00:00+09:00" },
    { id: "middle", basePriceKrw: 70_000, createdAt: "2026-11-14T10:00:00+09:00" },
  ]);
  assert.deepEqual(
    quote.lines.map((line) => [line.id, line.tier, line.amountKrw, line.discountKrw]),
    [
      ["cheap", "ADDITIONAL", 25_000, 25_000],
      ["dear", "FULL", 150_000, 0],
      ["middle", "ADDITIONAL", 35_000, 35_000],
    ],
  );
  assert.equal(quote.listTotalKrw, 270_000);
  assert.equal(quote.discountTotalKrw, 60_000);
  assert.equal(quote.totalKrw, 210_000);
});

test("equal prices: the earliest application is the full-price album, then the lowest id", () => {
  const byTime = quoteAlbumOrder([
    { id: "later", basePriceKrw: 100_000, createdAt: "2026-11-14T10:00:00+09:00" },
    { id: "earlier", basePriceKrw: 100_000, createdAt: "2026-11-14T09:00:00+09:00" },
  ]);
  assert.equal(byTime.byId.get("earlier")?.tier, "FULL");
  assert.equal(byTime.byId.get("later")?.amountKrw, 50_000);

  const byId = quoteAlbumOrder([
    { id: "b0000000", basePriceKrw: 100_000, createdAt: "2026-11-14T09:00:00+09:00" },
    { id: "a0000000", basePriceKrw: 100_000, createdAt: "2026-11-14T09:00:00+09:00" },
  ]);
  assert.equal(byId.byId.get("a0000000")?.tier, "FULL");
  // The total never depends on which equal-priced album is the full-price one.
  assert.equal(byTime.totalKrw, 150_000);
  assert.equal(byId.totalKrw, 150_000);
});

test("the cart quote discounts albums only and leaves music videos at their price", () => {
  const quote = quoteSubmissionCart([
    { id: "album-1", type: "ALBUM", amount_krw: 100_000, album_base_price_krw: 100_000, created_at: "2026-11-14T09:00:00+09:00" },
    { id: "album-2", type: "ALBUM", amount_krw: 100_000, album_base_price_krw: 100_000, created_at: "2026-11-14T10:00:00+09:00" },
    { id: "mv-1", type: "MV_DISTRIBUTION", amount_krw: 30_000 },
    { id: "mv-2", type: "MV_BROADCAST", amount_krw: 30_000 },
  ]);
  assert.equal(quote.listTotalKrw, 260_000);
  assert.equal(quote.discountTotalKrw, 50_000);
  assert.equal(quote.totalKrw, 210_000);
  assert.deepEqual(
    quote.lines.map((line) => [line.id, line.amountKrw, line.discounted]),
    [["album-1", 100_000, false], ["album-2", 50_000, true], ["mv-1", 30_000, false], ["mv-2", 30_000, false]],
  );
  // Two music videos alone are never discounted.
  assert.equal(quoteSubmissionCart([{ id: "a", type: "MV_DISTRIBUTION", amount_krw: 30_000 }, { id: "b", type: "MV_DISTRIBUTION", amount_krw: 30_000 }]).totalKrw, 60_000);
  // A row that still carries a half price from a returned order is quoted from its list price.
  assert.equal(quoteSubmissionCart([{ id: "a", type: "ALBUM", amount_krw: 50_000, album_base_price_krw: 100_000 }]).totalKrw, 100_000);
  // Older rows without the snapshot fall back to their amount.
  assert.equal(quoteSubmissionCart([{ id: "a", type: "ALBUM", amount_krw: 70_000 }, { id: "b", type: "ALBUM", amount_krw: 70_000 }]).totalKrw, 105_000);
});

test("an order's priced albums: one full-price album and half-price albums beside it", () => {
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [baseItem(), additionalItem()],
    }),
    { ok: true },
  );
  // Packages and release types may differ; the full-price album is the dearer one.
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [
        baseItem({ packageId: "package-15", isOneClick: true, basePriceKrw: 150_000, amountKrw: 150_000 }),
        additionalItem(),
      ],
    }),
    { ok: true },
  );
});

test("a half-price album cannot be paid alone", () => {
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

test("owner, tier amounts and the full-price album are all checked", () => {
  // Another member's album is not this order's full-price album.
  assert.equal(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [baseItem({ userId: "member-2" }), additionalItem()],
    }).ok,
    false,
  );
  // A cheaper album cannot be the full-price one beside a dearer half-price album.
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [baseItem(), additionalItem({ basePriceKrw: 150_000, amountKrw: 75_000 })],
    }),
    { ok: false, reason: "DISCOUNT_NOT_ELIGIBLE", itemId: "additional" },
  );
  // Two full-price albums mean the order was not priced.
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [baseItem(), baseItem({ id: "second" })],
    }),
    { ok: false, reason: "DISCOUNT_NOT_APPLIED", itemId: "second" },
  );
  assert.deepEqual(
    validateAlbumDiscountPaymentGroup({
      selectedItems: [baseItem(), additionalItem({ amountKrw: 49_999 })],
    }),
    { ok: false, reason: "INVALID_PRICE", itemId: "additional" },
  );
});

test("the database prices an order with the same rule", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20261114120000_album_additional_half_price.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /order by s\.album_base_price_krw desc, s\.created_at, s\.id/);
  assert.match(migration, /round\(a\.album_base_price_krw \* 0\.5\)::integer/);
  // Order creation prices the albums before it totals them, and a return undoes it.
  assert.match(migration, /perform public\.apply_album_checkout_discount\(ids\);\s*select case when p_method='PAYPAL'/);
  assert.match(migration, /current_order_id=null,payment_status='UNPAID'[\s\S]*?then s\.album_base_price_krw else s\.amount_krw end/);
});

test("a saved application always carries the list price; only the order discounts it", () => {
  assert.match(submissionActions, /serverBasePriceKrw = getAlbumReviewPriceKrw\(selectedPackage.price_krw\)/);
  assert.match(submissionActions, /amountKrw = serverBasePriceKrw;\s*albumPriceTier = "FULL"/);
  assert.doesNotMatch(submissionActions, /hasRecentBaseAlbumForDiscount|getAdditionalAlbumPriceKrw/);
});
