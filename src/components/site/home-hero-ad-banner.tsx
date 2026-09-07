import { Suspense } from "react";

import { getPublicAdBanners, selectPublicAdBanners } from "@/lib/public-ad-banners";
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
    title: "리뉴얼 기념 음반심의 30% 할인",
    description: "할인 금액으로 바로 접수하세요.",
    image_url: "/media/banners/home-hero/album-discount.svg",
    link_url: "/dashboard/new/album",
    starts_at: null,
    ends_at: null,
  },
];

async function HomeHeroAdBannerContent() {
  let banners = fallbackBanners;

  try {
    const activeBanners = selectPublicAdBanners(await getPublicAdBanners(), "HOME_HERO");
    if (activeBanners.length > 0) banners = activeBanners;
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      throw error;
    }
    console.error("[HomeHeroAdBanner] Failed to initialize banner query:", error);
  }

  return <HomeHeroAdBannerClient banners={banners} />;
}

export function HomeHeroAdBanner() {
  return (
    <Suspense fallback={<div aria-hidden="true" className="h-[112px] w-full max-w-[540px] rounded-[10px] border-2 border-border bg-card sm:h-[128px]" />}>
      <HomeHeroAdBannerContent />
    </Suspense>
  );
}
