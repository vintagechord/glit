"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { ReliableLink } from "@/components/site/reliable-link";

type HomeHeroAdBannerItem = {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  link_url: string | null;
};

const ROTATE_MS = 5200;

export function HomeHeroAdBannerClient({
  banners,
}: {
  banners: HomeHeroAdBannerItem[];
}) {
  const safeBanners = React.useMemo(
    () => (Array.isArray(banners) ? banners.filter(Boolean) : []),
    [banners],
  );
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    setIndex(0);
  }, [safeBanners.length]);

  React.useEffect(() => {
    if (safeBanners.length <= 1) return;
    const interval = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % safeBanners.length);
    }, ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [safeBanners.length]);

  const goTo = React.useCallback(
    (nextIndex: number) => {
      if (!safeBanners.length) return;
      setIndex((nextIndex + safeBanners.length) % safeBanners.length);
    },
    [safeBanners.length],
  );

  if (!safeBanners.length) return null;

  const banner = safeBanners[index] ?? safeBanners[0];

  return (
    <div className="w-full max-w-[540px]" aria-roledescription="carousel">
      <div className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
        <BannerLinkWrap banner={banner}>
          <div className="grid min-h-[108px] grid-cols-[98px_minmax(0,1fr)] sm:min-h-[124px] sm:grid-cols-[132px_minmax(0,1fr)]">
            <div className="relative overflow-hidden border-r-2 border-[#111111] bg-[#f2cf27] dark:border-[#f2cf27]">
              <Image
                src={banner.image_url}
                alt=""
                fill
                sizes="(min-width: 640px) 132px, 98px"
                className="object-cover"
                priority={false}
              />
            </div>
            <div className="flex min-w-0 flex-col justify-center px-3 py-3 pr-20 sm:px-4 sm:py-4 sm:pr-24">
              <p className="text-[10px] font-black uppercase leading-none tracking-[0.18em] text-[#1556a4] dark:text-[#f2cf27]">
                Onside Notice
              </p>
              <p className="mt-2 break-keep text-base font-black leading-snug text-[#111111] dark:text-white sm:text-[19px]">
                {banner.title}
              </p>
              {banner.description ? (
                <p className="mt-1 break-keep text-xs font-semibold leading-5 text-[#111111]/68 dark:text-white/72 sm:text-sm">
                  {banner.description}
                </p>
              ) : null}
            </div>
          </div>
        </BannerLinkWrap>

        {safeBanners.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="이전 광고"
              className="absolute right-12 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#111111] bg-white text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-x-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4]/65 dark:border-[#f2cf27] dark:bg-[#101010] dark:text-[#f2cf27] dark:shadow-[2px_2px_0_#f2cf27]"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="다음 광고"
              className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[2px_2px_0_#111111] transition hover:translate-x-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4]/65 dark:border-[#f2cf27] dark:shadow-[2px_2px_0_#f2cf27]"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
            </button>
            <div className="absolute bottom-2 right-3 flex items-center gap-1.5">
              {safeBanners.map((item, itemIndex) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTo(itemIndex)}
                  aria-label={`${itemIndex + 1}번 광고 보기`}
                  aria-current={itemIndex === index}
                  className={`h-1.5 rounded-full transition-all ${
                    itemIndex === index
                      ? "w-5 bg-[#111111] dark:bg-[#f2cf27]"
                      : "w-1.5 bg-[#111111]/28 dark:bg-white/28"
                  }`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function normalizeHref(input?: string | null): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  if (/^(mailto:|tel:|sms:)/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^https?\/\/+/i.test(raw)) {
    raw = raw.replace(/^https?\/\/+/i, (match) =>
      match.toLowerCase().startsWith("https") ? "https://" : "http://",
    );
    return raw;
  }
  if (/^https?:\/[^/]/i.test(raw)) {
    raw = raw.replace(/^https?:\//i, (match) =>
      match.toLowerCase().startsWith("https") ? "https://" : "http://",
    );
    return raw;
  }
  if (raw.includes("://")) return raw;
  return `https://${raw}`;
}

function isExternalHref(href: string) {
  return /^(https?:\/\/)/i.test(href) || /^(mailto:|tel:|sms:)/i.test(href);
}

function BannerLinkWrap({
  banner,
  children,
}: {
  banner: HomeHeroAdBannerItem;
  children: React.ReactNode;
}) {
  const href = normalizeHref(banner.link_url);
  if (!href) return <div>{children}</div>;
  const external = isExternalHref(href);
  return (
    <ReliableLink
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4]/65"
    >
      {children}
    </ReliableLink>
  );
}
