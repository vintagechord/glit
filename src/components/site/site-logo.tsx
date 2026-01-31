"use client";

import Link from "next/link";
import Image from "next/image";
import * as React from "react";

import { APP_CONFIG } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

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
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [srcIndex, setSrcIndex] = React.useState(0);

  const base = APP_CONFIG.logoPath || "/brand/glit-logo.svg";
  const lightLogo = APP_CONFIG.logoLightPath || base;
  const darkLogo = APP_CONFIG.logoDarkPath || lightLogo;

  const themeKey = resolvedTheme === "dark" ? "dark" : "light";

  const sources = React.useMemo(() => {
    const lightChain = [lightLogo, base, "/brand/glit-logo-light.svg", "/brand/glit-logo.svg"];
    const darkChain = [darkLogo, lightLogo, base, "/brand/glit-logo-dark.svg", "/brand/glit-logo.svg"];
    return themeKey === "dark" ? darkChain : lightChain;
  }, [base, darkLogo, lightLogo, themeKey]);

  React.useEffect(() => {
    setMounted(true);
    setSrcIndex(0);
  }, [themeKey]);

  const handleError = () => {
    setSrcIndex((prev) => (prev + 1 < sources.length ? prev + 1 : prev));
  };

  if (!mounted) {
    return (
      <div
        className={cn("inline-block h-8 w-[118px] shrink-0", className)}
        aria-hidden="true"
      />
    );
  }

  const currentSrc = sources[Math.min(srcIndex, sources.length - 1)];

  const img = (
    <>
      <Image
        src={currentSrc}
        alt={alt}
        height={height}
        width={width}
        className={cn("h-8 w-auto", className)}
        loading="lazy"
        onError={handleError}
        priority={false}
      />
      {showSrLabel ? <span className="sr-only">{alt}</span> : null}
    </>
  );

  const shouldLink = href !== null && href !== undefined;
  const linkHref = href ?? "/";

  return shouldLink ? (
    <Link href={linkHref} className="flex items-center gap-2">
      {img}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-2">{img}</span>
  );
}
