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
  height = 32,
  width = 118,
  showSrLabel = true,
}: SiteLogoProps) {
  const textLogo = (
    <span
      className={cn(
        "text-lg font-semibold tracking-[0.32em] text-black dark:text-white",
        className,
      )}
      aria-hidden={showSrLabel ? "true" : undefined}
    >
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
