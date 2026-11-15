import "server-only";

import { unstable_cache } from "next/cache";

import { HERO_BANNER_COLUMNS } from "@/lib/admin/hero-banner-admin";
import {
  DEFAULT_HERO_SLIDES,
  HERO_INTERVAL_DEFAULT,
  HERO_SETTINGS_KEY,
  normalizeHeroInterval,
  toHeroSlides,
  type HeroBannerRow,
  type HeroSlide,
} from "@/lib/home-hero-banners";
import { isDynamicServerUsageError } from "@/lib/next/dynamic-server-usage";
import { PUBLIC_HOME_HERO_CACHE_TAG } from "@/lib/public-cache-tags";
import { createAdminClient } from "@/lib/supabase/admin";

export type HomeHero = { slides: HeroSlide[]; intervalSeconds: number };

const loadHomeHero = unstable_cache(
  async (): Promise<HomeHero> => {
    const db = createAdminClient();
    const [banners, settings] = await Promise.all([
      db.from("home_hero_banners").select(HERO_BANNER_COLUMNS).order("sort_order").order("created_at"),
      db.from("site_settings").select("value").eq("key", HERO_SETTINGS_KEY).maybeSingle(),
    ]);
    // A failed refresh must not replace a healthy cache with the fallback.
    if (banners.error) throw banners.error;
    return {
      slides: toHeroSlides((banners.data ?? []) as HeroBannerRow[]),
      intervalSeconds: normalizeHeroInterval(settings.data?.value),
    };
  },
  ["home-hero-v1"],
  { revalidate: 3600, tags: [PUBLIC_HOME_HERO_CACHE_TAG] },
);

/**
 * The banners set under 메인 배너 관리. The page always has its banner: the
 * built-in set stands in while the saved set cannot be read.
 */
export async function getHomeHero(): Promise<HomeHero> {
  try {
    return await loadHomeHero();
  } catch (error) {
    if (isDynamicServerUsageError(error)) throw error;
    return { slides: DEFAULT_HERO_SLIDES, intervalSeconds: HERO_INTERVAL_DEFAULT };
  }
}
