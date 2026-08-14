export type AlbumPriceTier = "FULL" | "ADDITIONAL";

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

export const getAdditionalAlbumPriceKrw = (basePriceKrw: number) =>
  Math.max(0, Math.round(Number(basePriceKrw) * 0.5));

const hasSameSelectedGroupOwner = (
  left: AlbumDiscountPaymentItem,
  right: AlbumDiscountPaymentItem,
) =>
  left.userId
    ? left.userId === right.userId
    : !right.userId;

const hasSameHistoricalOwner = (
  left: AlbumDiscountPaymentItem,
  right: AlbumDiscountPaymentItem,
) =>
  left.userId
    ? left.userId === right.userId
    : !right.userId &&
      Boolean(left.guestToken && left.guestToken === right.guestToken);

const isMatchingFullPriceBase = (
  discounted: AlbumDiscountPaymentItem,
  candidate: AlbumDiscountPaymentItem,
  ownerMatches: (
    left: AlbumDiscountPaymentItem,
    right: AlbumDiscountPaymentItem,
  ) => boolean,
) =>
  candidate.id !== discounted.id &&
  candidate.priceTier === "FULL" &&
  candidate.packageId === discounted.packageId &&
  candidate.isOneClick === discounted.isOneClick &&
  candidate.basePriceKrw === discounted.basePriceKrw &&
  candidate.amountKrw === discounted.basePriceKrw &&
  ownerMatches(discounted, candidate);

/** Pure reference policy mirrored by the payment-integrity database RPCs. */
export function validateAlbumDiscountPaymentGroup(params: {
  selectedItems: AlbumDiscountPaymentItem[];
  paidItems?: AlbumDiscountPaymentItem[];
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

    if (item.priceTier !== "ADDITIONAL") continue;
    const selectedBase = params.selectedItems.some((candidate) =>
      isMatchingFullPriceBase(item, candidate, hasSameSelectedGroupOwner),
    );
    const paidBase = (params.paidItems ?? []).some(
      (candidate) =>
        candidate.paymentStatus === "PAID" &&
        isMatchingFullPriceBase(item, candidate, hasSameHistoricalOwner),
    );
    if (!selectedBase && !paidBase) {
      return {
        ok: false as const,
        reason: "DISCOUNT_NOT_ELIGIBLE",
        itemId: item.id,
      };
    }
  }

  return { ok: true as const };
}
