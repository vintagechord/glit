"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

type PendingNavigation = {
  id: string;
  fromPath: string;
  fromPathname: string;
  toPath: string;
  toPathname: string;
  startedAtPerfMs: number;
  startedAtEpochMs: number;
};

const STORAGE_KEY = "__glit_nav_latency_pending__";
const MAX_PENDING_AGE_MS = 120_000;
const TRACKED_PATHNAMES = new Set([
  "/dashboard",
  "/mypage",
  "/mypage/history",
  "/mypage/profile",
]);

let pendingNavigationInMemory: PendingNavigation | null = null;

const navPerfLoggingEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_NAV_PERF_DEBUG === "true";

function roundToTwo(num: number) {
  return Math.round(num * 100) / 100;
}

function isTrackedTransition(fromPathname: string, toPathname: string) {
  return TRACKED_PATHNAMES.has(fromPathname) && TRACKED_PATHNAMES.has(toPathname);
}

function parsePending(raw: string | null): PendingNavigation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingNavigation>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.fromPath !== "string" ||
      typeof parsed.fromPathname !== "string" ||
      typeof parsed.toPath !== "string" ||
      typeof parsed.toPathname !== "string" ||
      typeof parsed.startedAtPerfMs !== "number" ||
      typeof parsed.startedAtEpochMs !== "number"
    ) {
      return null;
    }
    if (!Number.isFinite(parsed.startedAtPerfMs) || !Number.isFinite(parsed.startedAtEpochMs)) {
      return null;
    }
    return {
      id: parsed.id,
      fromPath: parsed.fromPath,
      fromPathname: parsed.fromPathname,
      toPath: parsed.toPath,
      toPathname: parsed.toPathname,
      startedAtPerfMs: parsed.startedAtPerfMs,
      startedAtEpochMs: parsed.startedAtEpochMs,
    };
  } catch {
    return null;
  }
}

function readPendingNavigation() {
  if (pendingNavigationInMemory) {
    return pendingNavigationInMemory;
  }

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = parsePending(stored);
    if (parsed) {
      pendingNavigationInMemory = parsed;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingNavigation() {
  pendingNavigationInMemory = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function writePendingNavigation(pending: PendingNavigation) {
  pendingNavigationInMemory = pending;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Ignore storage failures.
  }
}

function computeDurationMs(pending: PendingNavigation) {
  const perfDuration = performance.now() - pending.startedAtPerfMs;
  if (Number.isFinite(perfDuration) && perfDuration >= 0 && perfDuration <= MAX_PENDING_AGE_MS) {
    return perfDuration;
  }
  return Date.now() - pending.startedAtEpochMs;
}

function buildPath(url: URL) {
  return `${url.pathname}${url.search}`;
}

export function NavigationLatencyLogger() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = React.useMemo(() => {
    const query = searchParams?.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }, [pathname, searchParams]);

  React.useEffect(() => {
    if (!navPerfLoggingEnabled) return;

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let nextUrl: URL;
      try {
        nextUrl = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (nextUrl.origin !== window.location.origin) return;

      const fromPath = `${window.location.pathname}${window.location.search}`;
      const fromPathname = window.location.pathname;
      const toPath = buildPath(nextUrl);
      const toPathname = nextUrl.pathname;

      if (fromPath === toPath) return;
      if (!isTrackedTransition(fromPathname, toPathname)) return;

      const pending: PendingNavigation = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromPath,
        fromPathname,
        toPath,
        toPathname,
        startedAtPerfMs: performance.now(),
        startedAtEpochMs: Date.now(),
      };

      writePendingNavigation(pending);
      console.info("[nav-perf][before]", {
        id: pending.id,
        from: pending.fromPath,
        to: pending.toPath,
        at: new Date(pending.startedAtEpochMs).toISOString(),
      });
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  React.useEffect(() => {
    if (!navPerfLoggingEnabled) return;

    const pending = readPendingNavigation();
    if (!pending) return;

    const ageMs = Date.now() - pending.startedAtEpochMs;
    if (ageMs < 0 || ageMs > MAX_PENDING_AGE_MS) {
      clearPendingNavigation();
      return;
    }

    if (pathname !== pending.toPathname) return;

    const routeReadyMs = computeDurationMs(pending);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const paintReadyMs = computeDurationMs(pending);
        console.info("[nav-perf][after]", {
          id: pending.id,
          from: pending.fromPath,
          to: pending.toPath,
          landedPath: currentPath,
          routeReadyMs: roundToTwo(routeReadyMs),
          paintReadyMs: roundToTwo(paintReadyMs),
          at: new Date().toISOString(),
        });
        clearPendingNavigation();
      });
    });
  }, [currentPath, pathname]);

  return null;
}
