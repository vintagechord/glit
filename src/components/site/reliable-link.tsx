"use client";

import Link, { type LinkProps } from "next/link";
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

export function ReliableLink({
  onClick,
  fallbackDelayMs = 700,
  target,
  ...props
}: ReliableLinkProps) {
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

  return <Link {...props} target={target} onClick={handleClick} />;
}
