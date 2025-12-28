"use client";

import * as React from "react";

type AdBanner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
};

export function StripAdBannerClient({ banners }: { banners: AdBanner[] }) {
  const [index, setIndex] = React.useState(0);
  const [enableTransition, setEnableTransition] = React.useState(true);
  const items = banners.length > 1 ? [...banners, banners[0]] : banners;

  React.useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setEnableTransition(true);
      setIndex((prev) => prev + 1);
    }, 4500);
    return () => clearInterval(interval);
  }, [banners.length]);

  React.useEffect(() => {
    if (banners.length <= 1) return;
    if (index === banners.length) {
      const timeout = setTimeout(() => {
        setEnableTransition(false);
        setIndex(0);
      }, 720);
      return () => clearTimeout(timeout);
    }
  }, [banners.length, index]);

  const translateY = `-${index * 100}%`;

  return (
    <div className="strip-shimmer overflow-hidden rounded-[28px] border border-white/40 bg-white/55 shadow-[0_18px_60px_rgba(15,23,42,0.2)] backdrop-blur-md dark:border-white/10 dark:bg-black/35">
      <div
        className="flex flex-col"
        style={{
          transform: `translateY(${translateY})`,
          transition: enableTransition ? "transform 0.7s ease" : "none",
        }}
      >
        {items.map((banner, itemIndex) => {
          const content = (
            <div className="flex h-20 items-center gap-3 overflow-hidden sm:h-24 sm:gap-4">
              <img
                src={banner.image_url}
                alt={banner.title}
                className="h-full w-24 object-cover sm:w-40 md:w-56"
              />
              <div className="flex flex-1 items-center justify-between gap-3 pr-4 sm:gap-4 sm:pr-6">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground sm:text-xs">
                    Ad
                  </p>
                  <p className="mt-1 text-xs font-semibold text-foreground sm:text-sm">
                    {banner.title}
                  </p>
                </div>
                <span className="rounded-full border border-border/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground sm:px-4 sm:py-2 sm:text-xs">
                  자세히 보기
                </span>
              </div>
            </div>
          );

          return banner.link_url ? (
            <a
              key={`${banner.id}-${itemIndex}`}
              href={banner.link_url}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {content}
            </a>
          ) : (
            <div key={`${banner.id}-${itemIndex}`}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
