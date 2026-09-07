"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

type ReliableLinkProps = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    disableEnglishLocalization?: boolean;
  };

function englishPathFor(pathname: string) {
  if (pathname === "/") return "/en";
  if (pathname === "/en" || pathname.startsWith("/en/")) return pathname;

  const prefixes = [
    "/dashboard",
    "/mypage",
    "/track",
    "/submissions",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/magazine",
    "/guide",
    "/faq",
    "/support",
    "/forms",
    "/about",
    "/apply",
  ];
  const match = prefixes.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? `/en${pathname}` : pathname;
}

function localizeHref(
  href: LinkProps["href"],
  isEnglishRoute: boolean,
  disabled: boolean,
) {
  if (disabled || !isEnglishRoute || typeof href !== "string") return href;
  if (
    href.startsWith("http") ||
    href.startsWith("mailto:") ||
    href.startsWith("#") ||
    href.startsWith("/api/") ||
    href.startsWith("/logout") ||
    href.startsWith("/pay/inicis")
  ) {
    return href;
  }

  try {
    const url = new URL(href, "https://onside.local");
    const nextPathname = englishPathFor(url.pathname);
    if (nextPathname === url.pathname) return href;
    return `${nextPathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function ReliableLink({
  disableEnglishLocalization = false,
  ...props
}: ReliableLinkProps) {
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const href = localizeHref(
    props.href,
    isEnglishRoute,
    disableEnglishLocalization,
  );
  // Let Next.js finish the transition, including slow streamed responses.
  // A timer-based document reload discards prefetched data and repeats work.
  return (
    <Link
      {...props}
      href={href}
      data-no-localize={disableEnglishLocalization ? "true" : undefined}
    />
  );
}
