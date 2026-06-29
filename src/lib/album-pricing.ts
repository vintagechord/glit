export const ALBUM_REVIEW_DISCOUNT_SETTING_KEY =
  "album_review_discount_percent";

export const ALBUM_REVIEW_PACKAGE_DISCOUNT_OVERRIDES: Record<number, number> = {
  3: 40,
  7: 40,
};

export const normalizeAlbumDiscountPercent = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

export const getAlbumReviewDiscountPercentForPackage = (
  baseDiscountPercent: number,
  stationCount?: number | null,
) => {
  const normalizedStationCount = Number(stationCount ?? 0);
  if (
    Number.isFinite(normalizedStationCount) &&
    Object.prototype.hasOwnProperty.call(
      ALBUM_REVIEW_PACKAGE_DISCOUNT_OVERRIDES,
      normalizedStationCount,
    )
  ) {
    return normalizeAlbumDiscountPercent(
      ALBUM_REVIEW_PACKAGE_DISCOUNT_OVERRIDES[normalizedStationCount],
    );
  }
  return normalizeAlbumDiscountPercent(baseDiscountPercent);
};

export const getDiscountedAlbumPrice = (
  originalPriceKrw: number,
  discountPercent: number,
  stationCount?: number | null,
) => {
  const original = Math.max(0, Math.round(Number(originalPriceKrw) || 0));
  const percent = getAlbumReviewDiscountPercentForPackage(
    discountPercent,
    stationCount,
  );
  return Math.max(0, Math.round(original * ((100 - percent) / 100)));
};

export const getAlbumDiscountAmount = (
  originalPriceKrw: number,
  discountPercent: number,
  stationCount?: number | null,
) =>
  Math.max(
    0,
    Math.round(Number(originalPriceKrw) || 0) -
      getDiscountedAlbumPrice(originalPriceKrw, discountPercent, stationCount),
  );
