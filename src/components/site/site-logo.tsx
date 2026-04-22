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
        "inline-flex items-center gap-2 text-[15px] font-semibold tracking-[0.16em] text-[#1d1d1f] dark:text-white sm:text-base",
        className,
      )}
      style={sizeStyle}
      aria-hidden={showSrLabel ? "true" : undefined}
    >
      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_0_5px_rgba(0,113,227,0.12)] dark:bg-[#2997ff] dark:shadow-[0_0_0_5px_rgba(41,151,255,0.14)]" />
      ONSIDE
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
