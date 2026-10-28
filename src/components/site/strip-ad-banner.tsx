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

// Keep our store in the brand rotation even when no managed banners are active.
const artmelonBanner = {
  id: "artmelon-brand",
  title: "아트멜론 Artmelon",
  image_url: "/brand/artmelon-wordmark.svg",
  link_url: "https://artmelon.co.kr/",
  kind: "artmelon" as const,
};

function isArtmelonBanner(banner: AdBanner) {
  try {
    const host = new URL(banner.link_url ?? "").hostname.toLowerCase();
    return host === "artmelon.co.kr" || host === "www.artmelon.co.kr";
  } catch {
    return false;
  }
}

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

  const bannersToShow = [...activeBanners.filter((banner) => !isArtmelonBanner(banner)), artmelonBanner];

  return <StripAdBannerClient banners={bannersToShow} />;
}

export function StripAdBanner() {
  return (
    <Suspense fallback={<div aria-hidden="true" className="h-[112px] rounded-[10px] border-2 border-border bg-card sm:h-[136px]" />}>
      <StripAdBannerContent />
    </Suspense>
  );
}
