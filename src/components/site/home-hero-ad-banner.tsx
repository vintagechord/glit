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
    title: "리오픈 기념 음반심의 50% 할인",
    description: "할인 금액으로 바로 접수하세요.",
    image_url: "/media/banners/home-hero/album-discount.svg",
    link_url: "/dashboard/new/album",
    starts_at: null,
    ends_at: null,
  },
  {
    id: "home-hero-magazine-credit",
    title: "심의 1건당 매거진 1크레딧",
    description: "워터멜론 매거진 발행 요청에 사용할 수 있어요.",
    image_url: "/media/banners/home-hero/magazine-credit.svg",
    link_url: "/magazine",
    starts_at: null,
    ends_at: null,
  },
  {
    id: "home-hero-legacy-site",
    title: "이전 온사이드도 1년간 운영",
    description: "기존 사이트가 편하면 같은 방식으로 접수 가능합니다.",
    image_url: "/media/banners/home-hero/legacy-site.svg",
    link_url: "https://onside17.com/",
    starts_at: null,
    ends_at: null,
  },
];

function isBannerActive(banner: HomeHeroAdBannerItem, now: Date) {
  const startsOk = !banner.starts_at || new Date(banner.starts_at) <= now;
  const endsOk = !banner.ends_at || new Date(banner.ends_at) >= now;
  return startsOk && endsOk;
}

export async function HomeHeroAdBanner() {
  let data: HomeHeroAdBannerItem[] | null = null;

  try {
    const supabase = createAdminClient();
    const { data: queryData, error } = await supabase
      .from("ad_banners")
      .select("id, title, description, image_url, link_url, starts_at, ends_at")
      .eq("is_active", true)
      .eq("placement", "HOME_HERO")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
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
