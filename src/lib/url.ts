import type { NextRequest } from "next/server";

const DEFAULT_PRODUCTION_ORIGIN = "https://glit-b1yn.onrender.com";

const normalizeConfiguredOrigin = (value?: string | null) => {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

type RequestHeaders = Pick<Request, "headers">;

const getDevelopmentRequestOrigin = (req?: RequestHeaders) => {
  const rawProto =
    req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req?.headers.get("x-forwarded-protocol")?.split(",")[0]?.trim() ||
    "http";
  const protocol = rawProto === "https" ? "https" : "http";
  const rawHost =
    req?.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req?.headers.get("host")?.trim() ||
    "localhost:3000";
  try {
    const parsed = new URL(`${protocol}://${rawHost}`);
    if (parsed.username || parsed.password || !parsed.hostname) {
      return "http://localhost:3000";
    }
    return parsed.origin;
  } catch {
    return "http://localhost:3000";
  }
};

export const getBaseUrl = (req?: RequestHeaders) => {
  const envUrl = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
  ]
    .map(normalizeConfiguredOrigin)
    .find((value): value is string => Boolean(value));
  if (envUrl) return envUrl;

  // Recovery emails and payment callbacks must never inherit an attacker-
  // controlled Host header in production. Runtime health still reports the
  // missing env, while this canonical fallback fails safe.
  if (process.env.NODE_ENV === "production") {
    return DEFAULT_PRODUCTION_ORIGIN;
  }
  return getDevelopmentRequestOrigin(req);
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
