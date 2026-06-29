export const ALBUM_REVIEW_DISCOUNT_SETTING_KEY =
  "album_review_discount_percent";

export const normalizeAlbumDiscountPercent = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

export const getDiscountedAlbumPrice = (
  originalPriceKrw: number,
  discountPercent: number,
) => {
  const original = Math.max(0, Math.round(Number(originalPriceKrw) || 0));
  const percent = normalizeAlbumDiscountPercent(discountPercent);
  return Math.max(0, Math.round(original * ((100 - percent) / 100)));
};

export const getAlbumDiscountAmount = (
  originalPriceKrw: number,
  discountPercent: number,
) =>
  Math.max(
    0,
    Math.round(Number(originalPriceKrw) || 0) -
      getDiscountedAlbumPrice(originalPriceKrw, discountPercent),
  );
