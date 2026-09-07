import "server-only";

import { unstable_cache } from "next/cache";
import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedImageSource } from "@/lib/image-source";
import { PUBLIC_AD_BANNERS_CACHE_TAG } from "@/lib/public-cache-tags";

export type PublicAdBanner = {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  link_url: string | null;
  placement: "HOME_HERO" | "STRIP";
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
};

const loadPublicAdBanners = unstable_cache(
  async (): Promise<PublicAdBanner[]> => {
    // Scheduled rows must be cached before their start time. Keep the existing
    // server-only client here; anonymous RLS excludes future banners.
    const { data, error } = await createAdminClient()
      .from("ad_banners")
      .select("id, title, description, image_url, link_url, placement, sort_order, starts_at, ends_at")
      .eq("is_active", true)
      .in("placement", ["HOME_HERO", "STRIP"])
      .order("created_at", { ascending: false });

    // A failed refresh must not replace a healthy cache with an empty result.
    if (error) throw error;
    return data ?? [];
  },
  ["public-ad-banners-v1"],
  { revalidate: 60, tags: [PUBLIC_AD_BANNERS_CACHE_TAG] },
);

// Hero and strip share one query even on the first render of an uncached page.
export const getPublicAdBanners = cache(loadPublicAdBanners);

export function selectPublicAdBanners(
  banners: PublicAdBanner[],
  placement: PublicAdBanner["placement"],
  now = new Date(),
) {
  const active = banners.filter((banner) =>
    banner.placement === placement &&
    (!banner.starts_at || new Date(banner.starts_at) <= now) &&
    (!banner.ends_at || new Date(banner.ends_at) >= now) &&
    isAllowedImageSource(banner.image_url),
  );

  // Preserve newest-first strip order and stable hero ties from the query.
  return placement === "HOME_HERO"
    ? active.sort((a, b) => a.sort_order - b.sort_order)
    : active;
}
