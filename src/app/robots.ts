import type { MetadataRoute } from "next";

import { getBaseUrl } from "@/lib/url";

// Member, operator, callback and token-bearing pages must not be indexed.
// Public marketing, guide and entry pages remain crawlable.
export default function robots(): MetadataRoute.Robots {
  const origin = getBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        // The application entry pages are public and listed in the sitemap;
        // the more specific Allow wins over the /dashboard/ Disallow.
        allow: ["/", "/dashboard/new", "/en/dashboard/new"],
        disallow: [
          "/admin", "/api/", "/auth/", "/dashboard/", "/mypage/", "/pay/", "/dev/",
          "/track/", "/submissions/", "/complete-signup", "/confirm-email", "/reset-password",
          "/forgot-password", "/logout", "/subscription", "/karaoke-request",
          "/en/dashboard/", "/en/mypage/", "/en/track/", "/en/submissions/",
          "/en/complete-signup", "/en/confirm-email", "/en/reset-password", "/en/forgot-password",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
