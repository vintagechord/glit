import { createServerSupabase } from "@/lib/supabase/server";
import { StripAdBannerClient } from "@/components/site/strip-ad-banner-client";

type AdBanner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

function isBannerActive(banner: AdBanner, now: Date) {
  const startsOk = !banner.starts_at || new Date(banner.starts_at) <= now;
  const endsOk = !banner.ends_at || new Date(banner.ends_at) >= now;
  return startsOk && endsOk;
}

export async function StripAdBanner() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("ad_banners")
    .select("id, title, image_url, link_url, starts_at, ends_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const now = new Date();
  const activeBanners = data?.filter((item) => isBannerActive(item, now)) ?? [];

  const bannersToShow =
    activeBanners.length > 0
      ? activeBanners
      : [
          {
            id: "fallback-banner",
            title: "온사이드 심의 접수 안내",
            image_url: "/media/hero/onside-hero-poster.jpg",
            link_url: "/dashboard/new",
            starts_at: null,
            ends_at: null,
          },
        ];

  return <StripAdBannerClient banners={bannersToShow} />;
}
