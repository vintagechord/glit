import { Suspense } from "react";

import { getPublicAdBanners, selectPublicAdBanners } from "@/lib/public-ad-banners";
import { StripAdBannerClient } from "@/components/site/strip-ad-banner-client";
import { isDynamicServerUsageError } from "@/lib/next/dynamic-server-usage";

type AdBanner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

async function StripAdBannerContent() {
  let activeBanners: AdBanner[] = [];
  try {
    activeBanners = selectPublicAdBanners(await getPublicAdBanners(), "STRIP");
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      throw error;
    }
    console.error("[StripAdBanner] Failed to initialize banner query:", error);
  }

  const bannersToShow =
    activeBanners.length > 0
      ? activeBanners
      : [
          {
            id: "fallback-banner",
            title: "온사이드 심의 접수 안내",
            image_url: "/media/hero/glit-hero-poster.jpg",
            link_url: "/dashboard/new",
            starts_at: null,
            ends_at: null,
          },
        ];

  return <StripAdBannerClient banners={bannersToShow} />;
}

export function StripAdBanner() {
  return (
    <Suspense fallback={<div aria-hidden="true" className="h-[112px] rounded-[10px] border-2 border-border bg-card sm:h-[136px]" />}>
      <StripAdBannerContent />
    </Suspense>
  );
}
