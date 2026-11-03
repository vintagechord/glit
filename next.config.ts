import type { NextConfig } from "next";

import { buildImageRemotePatterns } from "./src/lib/image-remote-patterns";

// Only this project's own storage (see src/lib/image-remote-patterns.ts).
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
