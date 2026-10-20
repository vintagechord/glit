import type { createAdminClient } from "@/lib/supabase/admin";

export const ALBUM_PRICE_CHANGED_MESSAGE =
  "음반 심의는 정가로 접수됩니다. 신청서를 열어 금액을 확인하고 다시 저장해주세요.";

type AlbumPrice = {
  amount_krw: number | null;
  album_base_price_krw: number | null;
  album_price_tier: string | null;
  package: { price_krw: number | null } | { price_krw: number | null }[] | null;
};

/** Check fresh checkout only. Issued orders retain their original snapshots. */
export async function validateAlbumPaymentPricing(
  db: Pick<ReturnType<typeof createAdminClient>, "from">,
  submissionIds: string[],
): Promise<string | null> {
  if (!submissionIds.length) return null;
  const { data, error } = await db
    .from("submissions")
    .select("amount_krw, album_base_price_krw, album_price_tier, package:packages(price_krw)")
    .in("id", [...new Set(submissionIds)])
    .eq("type", "ALBUM");
  if (error) return "음반 심의 금액을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";

  const invalid = (data as AlbumPrice[] | null)?.some((row) => {
    const pkg = Array.isArray(row.package) ? row.package[0] : row.package;
    const price = pkg?.price_krw;
    return (
      typeof price !== "number" || !Number.isSafeInteger(price) || price <= 0 ||
      row.album_price_tier !== "FULL" ||
      row.album_base_price_krw !== price ||
      row.amount_krw !== price
    );
  });
  return invalid ? ALBUM_PRICE_CHANGED_MESSAGE : null;
}
