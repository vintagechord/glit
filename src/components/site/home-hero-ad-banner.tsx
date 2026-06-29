import { createAdminClient } from "@/lib/supabase/admin";
import { isDynamicServerUsageError } from "@/lib/next/dynamic-server-usage";
import { HomeHeroAdBannerClient } from "@/components/site/home-hero-ad-banner-client";

type HomeHeroAdBannerItem = {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

const fallbackBanners: HomeHeroAdBannerItem[] = [
  {
    id: "home-hero-album-discount",
    title: "리뉴얼 기념 음반심의 50% 할인",
    description: "할인 금액으로 바로 접수하세요.",
    image_url: "/media/banners/home-hero/album-discount.svg",
    link_url: "/dashboard/new/album",
    starts_at: null,
    ends_at: null,
  },
];

const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

function isBannerActive(banner: HomeHeroAdBannerItem, now: Date) {
  const startsOk = !banner.starts_at || new Date(banner.starts_at) <= now;
  const endsOk = !banner.ends_at || new Date(banner.ends_at) >= now;
  return startsOk && endsOk;
}

export async function HomeHeroAdBanner() {
  let data: HomeHeroAdBannerItem[] | null = null;

  try {
    const supabase = createAdminClient({
      global: { fetch: noStoreFetch },
    });
    const { data: queryData, error } = await supabase
      .from("ad_banners")
      .select("id, title, description, image_url, link_url, starts_at, ends_at")
      .eq("is_active", true)
      .eq("placement", "HOME_HERO")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      if (isDynamicServerUsageError(error)) {
        throw error;
      }
      console.error("[HomeHeroAdBanner] Failed to fetch banners:", error.message);
    }

    data = queryData;
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      throw error;
    }
    console.error("[HomeHeroAdBanner] Failed to initialize banner query:", error);
  }

  const now = new Date();
  const activeBanners = data?.filter((item) => isBannerActive(item, now)) ?? [];
  const bannersToShow = activeBanners.length > 0 ? activeBanners : fallbackBanners;

  return <HomeHeroAdBannerClient banners={bannersToShow} />;
}
