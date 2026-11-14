export type AlbumPriceTier = "FULL" | "ADDITIONAL";

/** Every album after the first in one order is charged this much less. */
export const ADDITIONAL_ALBUM_DISCOUNT_PERCENT = 50;

/** Customer copy, shared so every page states the offer in the same words. */
export const ALBUM_MULTI_DISCOUNT_BADGE = "2번째 앨범부터 50% 할인";
export const ALBUM_MULTI_DISCOUNT_NOTICE =
  "음반 2건 이상을 함께 결제하면 2번째 앨범부터 50% 할인됩니다.";

export const getAdditionalAlbumPriceKrw = (basePriceKrw: number) =>
  Math.max(0, Math.round(Number(basePriceKrw) * 0.5));

export type AlbumOrderQuoteInput = {
  id: string;
  /** The package's list price saved on the application. */
  basePriceKrw: number | null | undefined;
  createdAt?: string | null;
};

export type AlbumOrderQuoteLine = {
  id: string;
  tier: AlbumPriceTier;
  basePriceKrw: number;
  amountKrw: number;
  discountKrw: number;
};

const normalizeBasePrice = (value: number | null | undefined) => {
  const price = Math.round(Number(value ?? 0));
  return Number.isFinite(price) && price > 0 ? price : 0;
};

const createdAtMs = (value?: string | null) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

/**
 * Price of the albums paid in one order. The highest-priced album is charged
 * in full and every other album at half of its own price; among equal prices
 * the earliest application is the full-price one. Music videos never enter
 * this quote. apply_album_checkout_discount writes the same result in the
 * database when the order is created, so this is what the customer is shown
 * and what the card window is opened with.
 */
export function quoteAlbumOrder(items: readonly AlbumOrderQuoteInput[]) {
  const priced = items
    .map((item) => ({
      id: item.id,
      basePriceKrw: normalizeBasePrice(item.basePriceKrw),
      createdAt: createdAtMs(item.createdAt),
      createdAtText: item.createdAt ?? "",
    }))
    .filter((item) => item.basePriceKrw > 0);
  const fullPriceId = [...priced].sort(
    (left, right) =>
      right.basePriceKrw - left.basePriceKrw ||
      left.createdAt - right.createdAt ||
      (left.createdAtText < right.createdAtText ? -1 : left.createdAtText > right.createdAtText ? 1 : 0) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  )[0]?.id;

  const lines: AlbumOrderQuoteLine[] = priced.map((item) => {
    const tier: AlbumPriceTier = item.id === fullPriceId ? "FULL" : "ADDITIONAL";
    const amountKrw =
      tier === "FULL" ? item.basePriceKrw : getAdditionalAlbumPriceKrw(item.basePriceKrw);
    return {
      id: item.id,
      tier,
      basePriceKrw: item.basePriceKrw,
      amountKrw,
      discountKrw: item.basePriceKrw - amountKrw,
    };
  });

  return {
    lines,
    byId: new Map(lines.map((line) => [line.id, line])),
    albumCount: lines.length,
    listTotalKrw: lines.reduce((sum, line) => sum + line.basePriceKrw, 0),
    discountTotalKrw: lines.reduce((sum, line) => sum + line.discountKrw, 0),
    totalKrw: lines.reduce((sum, line) => sum + line.amountKrw, 0),
  };
}

/** Several albums on one package, as the application form quotes them. */
export function quoteAlbumBundle(basePriceKrw: number, albumCount: number) {
  const count = Number.isFinite(Number(albumCount))
    ? Math.max(0, Math.trunc(Number(albumCount)))
    : 0;
  return quoteAlbumOrder(
    Array.from({ length: count }, (_, index) => ({
      id: String(index).padStart(6, "0"),
      basePriceKrw,
    })),
  );
}

export type AlbumDiscountPaymentItem = {
  id: string;
  userId: string | null;
  guestToken: string | null;
  packageId: string | null;
  isOneClick: boolean;
  amountKrw: number;
  basePriceKrw: number;
  priceTier: AlbumPriceTier;
  paymentStatus?: string | null;
};

const hasSameOrderOwner = (
  left: AlbumDiscountPaymentItem,
  right: AlbumDiscountPaymentItem,
) => (left.userId ? left.userId === right.userId : !right.userId);

/**
 * Pure reference of bind_album_payment_discount_eligibility: what an order's
 * albums must look like after the database has priced them. Packages may
 * differ; the full-price album is never cheaper than a discounted one, and a
 * discounted album is never payable without it.
 */
export function validateAlbumDiscountPaymentGroup(params: {
  selectedItems: AlbumDiscountPaymentItem[];
}) {
  for (const item of params.selectedItems) {
    if (
      !item.packageId ||
      !Number.isInteger(item.basePriceKrw) ||
      item.basePriceKrw <= 0 ||
      item.amountKrw !==
        (item.priceTier === "FULL"
          ? item.basePriceKrw
          : getAdditionalAlbumPriceKrw(item.basePriceKrw))
    ) {
      return { ok: false as const, reason: "INVALID_PRICE", itemId: item.id };
    }
  }

  const fullPriceItems = params.selectedItems.filter(
    (item) => item.priceTier === "FULL",
  );
  if (fullPriceItems.length > 1) {
    return {
      ok: false as const,
      reason: "DISCOUNT_NOT_APPLIED",
      itemId: fullPriceItems[1].id,
    };
  }

  for (const item of params.selectedItems) {
    if (item.priceTier !== "ADDITIONAL") continue;
    const hasFullPriceAlbum = fullPriceItems.some(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.basePriceKrw >= item.basePriceKrw &&
        hasSameOrderOwner(item, candidate),
    );
    if (!hasFullPriceAlbum) {
      return {
        ok: false as const,
        reason: "DISCOUNT_NOT_ELIGIBLE",
        itemId: item.id,
      };
    }
  }

  return { ok: true as const };
}
