import { createClient } from "@supabase/supabase-js";

import { FALLBACK_ALBUM_PACKAGES, type AlbumPackage } from "@/lib/review-guides";
import { getSupabaseEnv } from "@/lib/supabase/env";

type PackageRow = {
  name: string;
  station_count: number;
  price_krw: number;
  package_stations: Array<{ station: { name: string } | null }> | null;
};

/**
 * Album review packages for the public guides. Uses the anonymous key (the
 * package catalog is public) and falls back to the last known catalog so a
 * database hiccup never breaks a static page build.
 */
export async function loadAlbumPackages(): Promise<AlbumPackage[]> {
  try {
    const { url, anonKey } = getSupabaseEnv();
    const db = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await db
      .from("packages")
      .select("name,station_count,price_krw,package_stations(station:stations(name))")
      .eq("is_active", true)
      .order("station_count")
      .abortSignal(AbortSignal.timeout(8_000));
    if (error || !data?.length) return FALLBACK_ALBUM_PACKAGES;
    return (data as unknown as PackageRow[]).map((row) => ({
      name: row.name,
      stationCount: row.station_count,
      priceKrw: row.price_krw,
      stations: (row.package_stations ?? []).map((item) => item.station?.name).filter((name): name is string => Boolean(name)),
    }));
  } catch {
    return FALLBACK_ALBUM_PACKAGES;
  }
}
