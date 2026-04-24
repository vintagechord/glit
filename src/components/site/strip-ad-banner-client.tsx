"use client";

import Image from "next/image";
import * as React from "react";

type AdBanner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
};

const ROTATE_MS = 4500;

export function StripAdBannerClient({ banners }: { banners: AdBanner[] }) {
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

  if (safeBanners.length === 0) return null;

  const banner = safeBanners[index] ?? safeBanners[0];

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/40 bg-white/55 shadow-[0_18px_60px_rgba(15,23,42,0.2)] backdrop-blur-md dark:border-white/10 dark:bg-black/35">
      <div className="relative">
        <BannerLinkWrap banner={banner}>
          <BannerContent banner={banner} />
        </BannerLinkWrap>

        {safeBanners.length > 1 ? (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/82 text-sm font-bold text-[#1d1d1f] shadow-[0_10px_24px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white dark:border-white/14 dark:bg-black/46 dark:text-white dark:hover:bg-black/60"
                aria-label="이전 배너"
              >
                ←
              </button>
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/82 text-sm font-bold text-[#1d1d1f] shadow-[0_10px_24px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white dark:border-white/14 dark:bg-black/46 dark:text-white dark:hover:bg-black/60"
                aria-label="다음 배너"
              >
                →
              </button>
            </div>
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur dark:border-white/12 dark:bg-black/42">
              {safeBanners.map((item, itemIndex) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTo(itemIndex)}
                  aria-label={`${itemIndex + 1}번 배너로 이동`}
                  aria-pressed={itemIndex === index}
                  className={`h-2.5 w-2.5 rounded-full transition ${
                    itemIndex === index
                      ? "bg-[#0071e3] shadow-[0_0_0_4px_rgba(0,113,227,0.16)] dark:bg-[#8bc3ff]"
                      : "bg-black/18 hover:bg-black/35 dark:bg-white/28 dark:hover:bg-white/5"
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
    raw = raw.replace(/^https?\/\/+/i, (m) =>
      m.toLowerCase().startsWith("https") ? "https://" : "http://",
    );
    return raw;
  }
  if (/^https?:\/[^/]/i.test(raw)) {
    raw = raw.replace(/^https?:\//i, (m) =>
      m.toLowerCase().startsWith("https") ? "https://" : "http://",
    );
    return raw;
  }
  if (/^ht+tps?:\/\//i.test(raw)) {
    raw = raw.replace(/^ht+tps?:\/\//i, "https://");
    return raw;
  }
  if (/^ht+tps?\/\/+/i.test(raw)) {
    raw = raw.replace(/^ht+tps?\/\/+/i, "https://");
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
  banner: AdBanner;
  children: React.ReactNode;
}) {
  const href = normalizeHref(banner.link_url);
  if (!href) return <div>{children}</div>;
  const external = isExternalHref(href);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </a>
  );
}

function BannerContent({ banner }: { banner: AdBanner }) {
  return (
    <div className="px-2 py-2 sm:px-3 sm:py-3">
      <div className="group/banner relative flex h-20 overflow-hidden rounded-2xl border border-white/20 bg-white/25 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur-md transition duration-300 hover:shadow-[0_18px_50px_rgba(0,0,0,0.25)] hover:border-border/70 dark:border-white/10 dark:bg-black/35 sm:h-24">
        <Image
          src={banner.image_url}
          alt={banner.title}
          className="absolute inset-0 h-full w-full object-cover"
          width={1200}
          height={240}
          priority={false}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/30 via-black/10 to-white/85 transition duration-300 group-hover/banner:from-white/20 group-hover/banner:via-white/10 group-hover/banner:to-white/90 dark:from-black/45 dark:via-black/30 dark:to-black/85" />
        <div className="relative z-10 flex w-full min-w-0 items-center justify-between gap-3 px-3 sm:px-4">
          <div className="min-w-0 hidden sm:block">
            <div className="text-[10px] font-semibold uppercase leading-tight tracking-[0.2em] text-muted-foreground">
              <p>Our</p>
              <p>Other</p>
              <p>Brand</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
