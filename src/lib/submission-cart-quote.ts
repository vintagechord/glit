import { quoteAlbumOrder } from "@/lib/album-payment-discount";

export type SubmissionCartAmountItem = {
  id: string;
  type?: string | null;
  amount_krw?: number | null;
  album_base_price_krw?: number | null;
  created_at?: string | null;
};

const payableAmount = (value: number | null | undefined) => {
  const amount = Math.round(Number(value ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/**
 * What these applications cost when they are paid in one order: albums are
 * discounted from the second on, music videos keep their price. The order RPC
 * writes the same amounts, so the cart, the header total and the card window
 * all quote from here.
 */
export function quoteSubmissionCart(items: readonly SubmissionCartAmountItem[]) {
  const albums = quoteAlbumOrder(
    items
      .filter((item) => item.type === "ALBUM")
      .map((item) => ({
        id: item.id,
        basePriceKrw: item.album_base_price_krw ?? item.amount_krw,
        createdAt: item.created_at,
      })),
  );
  const lines = items.map((item) => {
    const album = albums.byId.get(item.id);
    const amountKrw = album?.amountKrw ?? payableAmount(item.amount_krw);
    return {
      id: item.id,
      listKrw: album?.basePriceKrw ?? amountKrw,
      amountKrw,
      discounted: album?.tier === "ADDITIONAL",
    };
  });

  return {
    lines,
    byId: new Map(lines.map((line) => [line.id, line])),
    albumCount: albums.albumCount,
    listTotalKrw: lines.reduce((sum, line) => sum + line.listKrw, 0),
    discountTotalKrw: albums.discountTotalKrw,
    totalKrw: lines.reduce((sum, line) => sum + line.amountKrw, 0),
  };
}
