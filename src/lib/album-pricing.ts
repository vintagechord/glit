export const ALBUM_REVIEW_DISCOUNT_SETTING_KEY =
  "album_review_discount_percent";

export const normalizeAlbumDiscountPercent = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

/** Current quotes use the package's original price for every album. */
export const getAlbumReviewPriceKrw = (
  packagePriceKrw: number,
  albumCount = 1,
) => {
  const price = Number(packagePriceKrw);
  const count = Number(albumCount);
  if (!Number.isFinite(price) || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.round(price)) * Math.max(0, Math.trunc(count));
};

// Keep these compatibility helpers for cached clients. Campaign percentages
// must no longer affect a new quote; historical receipts use stored snapshots.
export const getAlbumReviewDiscountPercentForPackage = (
  baseDiscountPercent: number,
  stationCount?: number | null,
) => {
  void baseDiscountPercent;
  void stationCount;
  return 0;
};

export const getDiscountedAlbumPrice = (
  originalPriceKrw: number,
  discountPercent: number,
  stationCount?: number | null,
) => {
  void discountPercent;
  void stationCount;
  return getAlbumReviewPriceKrw(originalPriceKrw);
};

export const getAlbumDiscountAmount = (
  originalPriceKrw: number,
  discountPercent: number,
  stationCount?: number | null,
) => {
  void originalPriceKrw;
  void discountPercent;
  void stationCount;
  return 0;
};
