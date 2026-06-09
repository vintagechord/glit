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
        "inline-flex items-center gap-2 text-[15px] font-black tracking-normal text-[#111111] dark:text-white sm:text-base",
        className,
      )}
      style={sizeStyle}
      aria-hidden={showSrLabel ? "true" : undefined}
    >
      <span className="inline-flex h-3 w-3 rounded-[2px] border-2 border-[#111111] bg-[#f2cf27] dark:border-[#f2cf27]" />
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
