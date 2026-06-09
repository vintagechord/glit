"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

type ReliableLinkProps = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    fallbackDelayMs?: number;
  };

function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function englishPathFor(pathname: string) {
  if (pathname === "/") return "/en";
  if (pathname === "/en" || pathname.startsWith("/en/")) return pathname;

  const prefixes = [
    "/dashboard",
    "/mypage",
    "/track",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/guide",
    "/faq",
    "/support",
    "/forms",
  ];
  const match = prefixes.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? `/en${pathname}` : pathname;
}

function localizeHref(href: LinkProps["href"], isEnglishRoute: boolean) {
  if (!isEnglishRoute || typeof href !== "string") return href;
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
  onClick,
  fallbackDelayMs = 700,
  target,
  ...props
}: ReliableLinkProps) {
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const href = localizeHref(props.href, isEnglishRoute);
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (
        event.defaultPrevented ||
        !isPlainLeftClick(event) ||
        (target && target !== "_self") ||
        event.currentTarget.hasAttribute("download")
      ) {
        return;
      }

      const destination = event.currentTarget.href;
      let nextUrl: URL;
      try {
        nextUrl = new URL(destination);
      } catch {
        return;
      }

      if (nextUrl.origin !== window.location.origin) return;

      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (currentPath === nextPath) return;

      window.setTimeout(() => {
        const stillHere = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (stillHere === currentPath) {
          window.location.assign(destination);
        }
      }, fallbackDelayMs);
    },
    [fallbackDelayMs, onClick, target],
  );

  return <Link {...props} href={href} target={target} onClick={handleClick} />;
}
