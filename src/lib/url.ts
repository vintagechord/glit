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

export const getClientIp = (req?: NextRequest) => {
  const forwarded = req?.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",").map((p) => p.trim())[0];
    if (first) return first;
  }
  return req?.ip || "127.0.0.1";
};
