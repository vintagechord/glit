import {
  ALBUM_REVIEW_DISCOUNT_SETTING_KEY,
  normalizeAlbumDiscountPercent,
} from "@/lib/album-pricing";

type SettingsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data?: { value?: unknown } | null;
          error?: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
};

const isMissingSettingsTable = (error?: { code?: string; message?: string } | null) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  Boolean(error?.message?.toLowerCase().includes("site_settings"));

export async function getAlbumReviewDiscountPercent(db: unknown) {
  const settingsDb = db as SettingsClient;
  const { data, error } = await settingsDb
    .from("site_settings")
    .select("value")
    .eq("key", ALBUM_REVIEW_DISCOUNT_SETTING_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingSettingsTable(error)) return 0;
    console.warn("[album discount] failed to load setting", error);
    return 0;
  }

  const value = data?.value;
  const discountPercent =
    value && typeof value === "object" && "discountPercent" in value
      ? (value as { discountPercent?: unknown }).discountPercent
      : value;

  return normalizeAlbumDiscountPercent(discountPercent);
}
