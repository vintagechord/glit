"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
            <BannerNavButton
              direction="previous"
              onClick={() => goTo(index - 1)}
            />
            <BannerNavButton
              direction="next"
              onClick={() => goTo(index + 1)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function BannerNavButton({
  direction,
  onClick,
}: {
  direction: "previous" | "next";
  onClick: () => void;
}) {
  const isPrevious = direction === "previous";
  const Icon = isPrevious ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrevious ? "이전 배너" : "다음 배너"}
      className={`group/control absolute top-1/2 z-20 inline-flex h-14 w-8 -translate-y-1/2 items-center justify-center border border-white/65 bg-white/78 text-[#1d1d1f] shadow-[0_12px_28px_rgba(15,23,42,0.16)] backdrop-blur-md transition-[width,background-color,border-color,box-shadow] duration-200 hover:w-10 hover:border-white/85 hover:bg-white/92 hover:shadow-[0_16px_36px_rgba(15,23,42,0.22)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/65 dark:border-white/12 dark:bg-black/48 dark:text-white dark:hover:border-white/20 dark:hover:bg-black/68 sm:h-16 sm:w-9 sm:hover:w-11 ${
        isPrevious
          ? "left-0 rounded-r-full border-l-0 pl-0.5"
          : "right-0 rounded-l-full border-r-0 pr-0.5"
      }`}
    >
      <Icon
        aria-hidden="true"
        className={`h-5 w-5 transition-transform duration-200 sm:h-[22px] sm:w-[22px] ${
          isPrevious
            ? "group-hover/control:-translate-x-0.5"
            : "group-hover/control:translate-x-0.5"
        }`}
        strokeWidth={2.2}
      />
    </button>
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
