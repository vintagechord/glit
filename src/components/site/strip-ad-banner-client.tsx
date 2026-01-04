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
const TRANSITION_MS = 700;

export function StripAdBannerClient({ banners }: { banners: AdBanner[] }) {
  const safeBanners = React.useMemo(
    () => (Array.isArray(banners) ? banners.filter(Boolean) : []),
    [banners],
  );

  const items = React.useMemo(() => {
    if (safeBanners.length <= 1) return safeBanners;
    return [...safeBanners, safeBanners[0]];
  }, [safeBanners]);

  const [index, setIndex] = React.useState(0);
  const [enableTransition, setEnableTransition] = React.useState(true);
  const firstRowRef = React.useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = React.useState<number>(0);

  React.useEffect(() => {
    const el = firstRowRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (h && Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowHeight]);

  React.useEffect(() => {
    if (items.length <= 1) return;
    const interval = window.setInterval(() => {
      setEnableTransition(true);
      setIndex((prev) => prev + 1);
    }, ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [items.length]);

  React.useEffect(() => {
    if (items.length <= 1) return;
    const lastIndex = items.length - 1;
    if (index !== lastIndex) return;

    const t = window.setTimeout(() => {
      setEnableTransition(false);
      setIndex(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEnableTransition(true));
      });
    }, TRANSITION_MS);

    return () => window.clearTimeout(t);
  }, [index, items.length]);

  if (safeBanners.length === 0) return null;

  // 단일 배너
  if (safeBanners.length === 1) {
    const banner = safeBanners[0];
    return (
      <div className="overflow-hidden rounded-[28px] border border-white/40 bg-white/55 shadow-[0_18px_60px_rgba(15,23,42,0.2)] backdrop-blur-md dark:border-white/10 dark:bg-black/35">
        <BannerLinkWrap banner={banner}>
          <BannerContent banner={banner} />
        </BannerLinkWrap>
      </div>
    );
  }

  // 높이 측정 전
  if (rowHeight <= 0) {
    const banner = safeBanners[0];
    return (
      <div className="overflow-hidden rounded-[28px] border border-white/40 bg-white/55 shadow-[0_18px_60px_rgba(15,23,42,0.2)] backdrop-blur-md dark:border-white/10 dark:bg-black/35">
        <div ref={firstRowRef}>
          <BannerContent banner={banner} />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/40 bg-white/55 shadow-[0_18px_60px_rgba(15,23,42,0.2)] backdrop-blur-md dark:border-white/10 dark:bg-black/35">
      <div className="relative overflow-hidden" style={{ height: rowHeight }}>
        <div
          className="flex flex-col will-change-transform"
          style={{
            transform: `translateY(-${index * rowHeight}px)`,
            transition: enableTransition
              ? `transform ${TRANSITION_MS}ms ease`
              : "none",
          }}
        >
          {items.map((banner, itemIndex) => {
            const row = (
              <BannerLinkWrap banner={banner}>
                <BannerContent banner={banner} />
              </BannerLinkWrap>
            );

            if (itemIndex === 0) {
              return (
                <div key={`wrap-${banner.id}-${itemIndex}`} ref={firstRowRef}>
                  {row}
                </div>
              );
            }

            return (
              <div key={`${banner.id}-${itemIndex}`} className="block">
                {row}
              </div>
            );
          })}
        </div>
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
  return (
    /^(https?:\/\/)/i.test(href) || /^(mailto:|tel:|sms:)/i.test(href)
  );
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
        <div className="relative h-full flex-[0_0_68%] sm:flex-[0_0_74%] md:flex-[0_0_80%]">
          <Image
            src={banner.image_url}
            alt={banner.title}
            className="h-full w-full object-cover"
            width={800}
            height={200}
            priority={false}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/25 via-black/10 to-transparent transition duration-300 group-hover/banner:from-white/25 group-hover/banner:via-white/10 group-hover/banner:to-transparent dark:from-black/35 dark:via-black/20" />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 sm:px-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase leading-tight tracking-[0.2em] text-muted-foreground">
              <p>Out</p>
              <p>Other</p>
              <p>Brand</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-border/70 bg-background/40 px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-foreground transition duration-300 group-hover/banner:-translate-y-0.5 group-hover/banner:border-white/70 group-hover/banner:bg-white/80 group-hover/banner:text-black dark:group-hover/banner:bg-white/20 dark:group-hover/banner:text-white sm:px-4 sm:py-2 sm:text-xs">
            {banner.title}
          </span>
        </div>
      </div>
    </div>
  );
}
