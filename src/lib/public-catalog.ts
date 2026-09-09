import "server-only";

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

import { getSupabaseEnv } from "@/lib/supabase/env";
import {
  ALBUM_REVIEW_DISCOUNT_SETTING_KEY,
  normalizeAlbumDiscountPercent,
} from "@/lib/album-pricing";
import {
  PUBLIC_CATALOG_CACHE_TAG,
  PUBLIC_ALBUM_DISCOUNT_CACHE_TAG,
  PUBLIC_PROFANITY_TERMS_CACHE_TAG,
} from "@/lib/public-cache-tags";
import { isDynamicServerUsageError } from "@/lib/next/dynamic-server-usage";

// Public RLS applies to every query. Never attach request cookies or a user
// session to data that is shared between visitors.
const createPublicCatalogClient = () => {
  const { url, anonKey } = getSupabaseEnv();
  return createClient(url, anonKey, {
    global: { fetch: fetchWithTimeout },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const albumStationOrderByCount: Record<number, string[]> = {
  3: ["KBS", "MBC", "SBS"],
  7: ["KBS", "MBC", "SBS", "CBS", "WBS", "TBS", "YTN"],
  10: ["KBS", "MBC", "SBS", "TBS", "CBS", "PBC", "WBS", "BBS", "YTN", "ARIRANG"],
  13: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
  ],
  15: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
    "FEBC",
    "GUGAK",
  ],
};

const albumStationLabelByCode: Record<string, string> = {
  KBS: "KBS",
  MBC: "MBC",
  SBS: "SBS",
  CBS: "CBS 기독교방송",
  WBS: "WBS 원음방송",
  TBS: "TBS 교통방송",
  YTN: "YTN",
  PBC: "PBC 평화방송",
  BBS: "BBS 불교방송",
  ARIRANG: "Arirang 방송",
  GYEONGIN_IFM: "경인 iFM",
  TBN: "TBN 한국교통방송",
  KISS: "KISS 디지털 라디오 음악방송",
  FEBC: "극동방송",
  GUGAK: "국악방송",
};

const normalizeStations = (
  stations: Array<{ id: string; name: string; code: string }>,
  stationCount: number,
) => {
  const order = albumStationOrderByCount[stationCount];
  const stationByCode = new Map(
    stations.map((station) => [station.code, station]),
  );
  if (!order) {
    return stations.map((station) => ({
      ...station,
      name: albumStationLabelByCode[station.code] ?? station.name,
    }));
  }
  return order
    .map((code) => {
      const station = stationByCode.get(code);
      const name = albumStationLabelByCode[code] ?? station?.name ?? code;
      if (station) {
        return { ...station, name };
      }
      return { id: `station-${code}`, name, code };
    })
    .filter(Boolean);
};

const isTestPackage = (name?: string | null) => name?.startsWith("[테스트]") ?? false;

const sortPackagesForDisplay = <
  T extends { name?: string | null; stationCount: number; priceKrw: number },
>(
  packages: T[],
) =>
  [...packages].sort((a, b) => {
    const aIsTest = isTestPackage(a.name);
    const bIsTest = isTestPackage(b.name);
    if (aIsTest !== bIsTest) return aIsTest ? 1 : -1;
    return a.stationCount - b.stationCount || a.priceKrw - b.priceKrw;
  });

const loadAlbumPackages = unstable_cache(
  async () => {
    const { data, error } = await createPublicCatalogClient()
      .from("packages")
      .select("id, name, station_count, price_krw, description, package_stations ( station:stations ( id, name, code ) )")
      .eq("is_active", true)
      .order("station_count", { ascending: true });

    if (error) throw error;
    const packages = (data ?? []).map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      stationCount: pkg.station_count,
      priceKrw: pkg.price_krw,
      description: pkg.description,
      stations: normalizeStations(
        pkg.package_stations?.flatMap((row) => {
          if (!row.station) return [];
          return Array.isArray(row.station) ? row.station : [row.station];
        }) ?? [],
        pkg.station_count,
      ),
    }));
    return sortPackagesForDisplay(packages.filter((pkg) => !isTestPackage(pkg.name)));
  },
  ["public-album-packages-v1"],
  { revalidate: 60, tags: [PUBLIC_CATALOG_CACHE_TAG] },
);

async function getAlbumPackages() {
  try {
    return await loadAlbumPackages();
  } catch (error) {
    if (isDynamicServerUsageError(error)) throw error;
    console.warn("[public catalog] package join unavailable", error);
    // Keep the existing schema-compatibility fallback outside the cache, so a
    // temporary join failure never becomes a cached empty or incomplete catalog.
    const { data } = await createPublicCatalogClient()
      .from("packages")
      .select("id, name, station_count, price_krw, description")
      .eq("is_active", true)
      .order("station_count", { ascending: true });
    return sortPackagesForDisplay((data ?? [])
      .filter((pkg) => !isTestPackage(pkg.name))
      .map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        stationCount: pkg.station_count,
        priceKrw: pkg.price_krw,
        description: pkg.description,
        stations: normalizeStations([], pkg.station_count),
      })));
  }
}

const loadAlbumDiscountPercent = unstable_cache(
  async () => {
    const { data, error } = await createPublicCatalogClient()
      .from("site_settings")
      .select("value")
      .eq("key", ALBUM_REVIEW_DISCOUNT_SETTING_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    const discountPercent = value && typeof value === "object" && "discountPercent" in value
      ? value.discountPercent
      : value;
    return normalizeAlbumDiscountPercent(discountPercent);
  },
  ["public-album-discount-v1"],
  { revalidate: 60, tags: [PUBLIC_ALBUM_DISCOUNT_CACHE_TAG] },
);

const loadProfanityTerms = unstable_cache(
  async () => {
    const { data, error } = await createPublicCatalogClient()
      .from("profanity_terms")
      .select("term, language")
      .eq("is_active", true)
      .order("term", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({ term: row.term, language: row.language }));
  },
  ["public-profanity-terms-v1"],
  { revalidate: 300, tags: [PUBLIC_PROFANITY_TERMS_CACHE_TAG] },
);

async function withUncachedFallback<T>(query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (isDynamicServerUsageError(error)) throw error;
    console.warn("[public catalog] query unavailable", error);
    return fallback;
  }
}

// Display data only. Submission and payment actions continue to load current
// prices and discounts directly from the database before accepting payment.
export async function getPublicAlbumCatalog() {
  const [packages, albumDiscountPercent, profanityTerms] = await Promise.all([
    getAlbumPackages(),
    withUncachedFallback(loadAlbumDiscountPercent(), 0),
    withUncachedFallback(loadProfanityTerms(), []),
  ]);
  return { packages, albumDiscountPercent, profanityTerms };
}
