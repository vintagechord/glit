import type { MetadataRoute } from "next";

import { getBaseUrl } from "@/lib/url";

// AI-training and bulk SEO crawlers add server load without bringing search
// visitors. Search engines (Google, Naver, Daum, Bing) and AI search/answer
// fetchers that cite the site stay allowed under "*".
const blockedCrawlers = [
  "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended",
  "Bytespider", "meta-externalagent", "FacebookBot", "Amazonbot", "cohere-ai", "Diffbot",
  "omgili", "ImagesiftBot", "Timpibot", "PetalBot", "MJ12bot", "DotBot", "BLEXBot",
  "DataForSeoBot", "SemrushBot", "AhrefsBot",
];

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
      { userAgent: blockedCrawlers, disallow: "/" },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
