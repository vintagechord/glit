import type { NextRequest } from "next/server";

const clean = (url?: string | null) => (url ?? "").replace(/\/+$/, "");

export const getBaseUrl = (req?: NextRequest) => {
  const envUrl =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    clean(process.env.APP_URL);
  if (envUrl) return envUrl;

  const proto =
    req?.headers.get("x-forwarded-proto") ||
    req?.headers.get("x-forwarded-protocol") ||
    "https";
  const host =
    req?.headers.get("x-forwarded-host") || req?.headers.get("host") || "localhost:3000";

  return `${proto}://${host}`.replace(/\/+$/, "");
};

/**
 * Safely builds an absolute URL from a base origin and a path using the WHATWG URL parser.
 * This avoids accidental double slashes or malformed concatenation.
 */
export const buildUrl = (path: string, base: string) => new URL(path, base).toString();

export const getClientIp = (req?: NextRequest) => {
  const forwarded = req?.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",").map((p) => p.trim())[0];
    if (first) return first;
  }
  // NextRequest.ip is available at runtime but not typed in some versions
  const ip = (req as { ip?: string | null })?.ip;
  return ip || "127.0.0.1";
};
