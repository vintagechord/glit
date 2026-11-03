import type { NextConfig } from "next";

type RemotePattern = Exclude<NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number], URL>;
type ImageEnv = Partial<Record<"NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "B2_S3_ENDPOINT" | "B2_BUCKET", string>>;

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
 * come from the build environment (the same variables as
 * src/lib/supabase/env.ts and src/lib/b2.ts); when one is missing, that
 * storage is simply not optimized instead of falling back to a wildcard.
 */
export function buildImageRemotePatterns(env: ImageEnv): RemotePattern[] {
  const patterns: RemotePattern[] = [];
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

const imageRemotePatterns = buildImageRemotePatterns({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  B2_S3_ENDPOINT: process.env.B2_S3_ENDPOINT,
  B2_BUCKET: process.env.B2_BUCKET,
});
if (!imageRemotePatterns.some((pattern) => pattern.pathname?.startsWith("/storage/"))) {
  console.warn("[next.config] NEXT_PUBLIC_SUPABASE_URL is not set; Supabase Storage images will not be optimized.");
}

const nextConfig: NextConfig = {
  // Reserve memory for on-demand document readers on the existing Free host.
  ...(process.env.REVIEW_DOCS_LOW_MEMORY === "true" ? { cacheMaxMemorySize: 8 * 1024 * 1024 } : {}),
  outputFileTracingIncludes: {
    "/api/admin/**": ["./templates/review-docs/**/*.docx", "./services/review-docs/extract.py", "./services/review-docs/check.py", "./src/assets/fonts/nanum-gothic/*.ttf"],
    // Cash receipt PDFs embed Nanum Gothic read from disk at runtime.
    "/api/orders/**": ["./src/assets/fonts/nanum-gothic/*.ttf"],
  },
  // Vercel optimizes /_next/image outside the function, so the sharp fallbacks
  // (the 9 MB WebAssembly build in particular) only slow cold starts.
  outputFileTracingExcludes: {
    "/*": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  images: {
    // Banner uploads get a timestamped name, so an optimized copy never has to
    // expire early; the default 4 hours made the first visitor afterwards wait
    // for a new optimization.
    minimumCacheTTL: 2678400,
    remotePatterns: imageRemotePatterns,
  },
  // Broadcaster and radio reviews are album reviews, so their former guide
  // pages (already submitted to search engines) point at the album guide.
  async redirects() {
    return [
      { source: "/guide/broadcast-review", destination: "/guide/album-review", permanent: true },
      { source: "/guide/radio-review", destination: "/guide/album-review", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; frame-ancestors 'self'; object-src 'none'",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
      {
        // OAuth callback queries must never become a subsequent Referer.
        // This must follow the general site policy above.
        source: "/auth/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
