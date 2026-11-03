import { isDynamicServerUsageError } from "@/lib/next/dynamic-server-usage";
import { getPublicAlbumCatalog } from "@/lib/public-catalog";
import { FALLBACK_ALBUM_PACKAGES, type AlbumPackage } from "@/lib/review-guides";

/**
 * Album review packages for the public guides. Reads the same tagged cache as
 * the application form, so admin package edits refresh the guide at once and
 * "[테스트]" packages stay hidden. Falls back to the last known catalog so a
 * database outage never breaks a static page build.
 */
export async function loadAlbumPackages(): Promise<AlbumPackage[]> {
  try {
    const { packages } = await getPublicAlbumCatalog();
    if (!packages.length) return FALLBACK_ALBUM_PACKAGES;
    return packages.map((pkg) => ({
      name: pkg.name,
      stationCount: pkg.stationCount,
      priceKrw: pkg.priceKrw,
      stations: pkg.stations.map((station) => station.name),
    }));
  } catch (error) {
    if (isDynamicServerUsageError(error)) throw error;
    return FALLBACK_ALBUM_PACKAGES;
  }
}
