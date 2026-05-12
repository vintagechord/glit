"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

type SiteLogoProps = {
  href?: string | null;
  className?: string;
  alt?: string;
  height?: number;
  width?: number;
  showSrLabel?: boolean;
};

export function SiteLogo({
  href = "/",
  className,
  alt = "온사이드",
  height,
  width,
  showSrLabel = true,
}: SiteLogoProps) {
  const sizeStyle =
    typeof width === "number" || typeof height === "number"
      ? {
          width: typeof width === "number" ? `${width}px` : undefined,
          height: typeof height === "number" ? `${height}px` : undefined,
        }
      : undefined;
  const textLogo = (
    <span
      className={cn(
        "inline-flex flex-col leading-none text-[#1268b3] dark:text-[#8bc3ff]",
        className,
      )}
      style={sizeStyle}
      aria-hidden={showSrLabel ? "true" : undefined}
    >
      <span className="text-[19px] font-semibold tracking-normal sm:text-[21px]">
        ONSIDE
      </span>
      <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-normal text-[#7a8797] dark:text-white/56">
        Review System
      </span>
    </span>
  );

  const shouldLink = href !== null && href !== undefined;
  const linkHref = href ?? "/";
  const ariaProps = showSrLabel ? { "aria-label": alt } : {};

  return shouldLink ? (
    <Link href={linkHref} className="flex items-center gap-2" {...ariaProps}>
      {textLogo}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-2" {...ariaProps}>
      {textLogo}
    </span>
  );
}
