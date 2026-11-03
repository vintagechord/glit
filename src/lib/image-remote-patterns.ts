import type { NextConfig } from "next";

export type ImageRemotePattern = Exclude<NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number], URL>;
export type ImageEnv = Partial<Record<"NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "B2_S3_ENDPOINT" | "B2_BUCKET", string>>;

const parseStorageUrl = (value?: string) => {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
};

/**
 * next/image may optimize only this project's own storage. The former
 * wildcards (any *.supabase.co project, any *.backblazeb2.com bucket) let the
 * optimizer fetch and re-serve images from storage anyone can create. Hosts
 * come from the environment (the same variables as src/lib/supabase/env.ts
 * and src/lib/b2.ts); when one is missing, that storage is simply not
 * optimized instead of falling back to a wildcard. next.config.ts builds its
 * remotePatterns here and src/lib/image-source.ts checks saved URLs against
 * the same list.
 */
export function buildImageRemotePatterns(env: ImageEnv): ImageRemotePattern[] {
  const patterns: ImageRemotePattern[] = [];
  const supabaseHosts = new Map<string, URL>();
  for (const value of [env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL]) {
    const url = parseStorageUrl(value);
    if (url) supabaseHosts.set(url.host, url);
  }
  for (const url of supabaseHosts.values()) {
    for (const pathname of ["/storage/v1/object/public/**", "/storage/v1/object/sign/**"]) {
      patterns.push({ protocol: url.protocol === "http:" ? "http" : "https", hostname: url.hostname, port: url.port, pathname });
    }
  }
  const b2Endpoint = parseStorageUrl(env.B2_S3_ENDPOINT);
  const b2Bucket = env.B2_BUCKET?.trim();
  // B2 bucket names are 6-63 letters, digits and hyphens.
  if (b2Endpoint?.protocol === "https:" && b2Bucket && /^[A-Za-z0-9-]{6,63}$/.test(b2Bucket)) {
    // Path-style presigned URLs (src/lib/b2.ts sets forcePathStyle) and the
    // same bucket's virtual-hosted address.
    patterns.push({ protocol: "https", hostname: b2Endpoint.hostname, port: b2Endpoint.port, pathname: `/${b2Bucket}/**` });
    patterns.push({ protocol: "https", hostname: `${b2Bucket}.${b2Endpoint.hostname}`, port: b2Endpoint.port, pathname: "/**" });
  }
  patterns.push({ protocol: "https", hostname: "image.genie.co.kr" });
  return patterns;
}

/**
 * Whether a URL falls inside the patterns above. Their hostnames are exact and
 * their pathnames end in "/**", so plain comparisons do; an explicit port must
 * match the pattern's (none when it sets none). Tests compare this with
 * next/image's own matcher.
 */
export function matchesImageRemotePattern(patterns: ImageRemotePattern[], url: URL) {
  return patterns.some((pattern) => {
    if (pattern.protocol && `${pattern.protocol}:` !== url.protocol) return false;
    if (pattern.hostname !== url.hostname || (pattern.port ?? "") !== url.port) return false;
    if (pattern.search !== undefined && pattern.search !== url.search) return false;
    const pathname = pattern.pathname ?? "/**";
    return pathname.endsWith("/**") ? url.pathname.startsWith(pathname.slice(0, -2)) : url.pathname === pathname;
  });
}
