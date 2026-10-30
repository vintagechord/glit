import type { MetadataRoute } from "next";

import { getBaseUrl } from "@/lib/url";

const publicPages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/dashboard/new", priority: 0.9, changeFrequency: "weekly" },
  { path: "/guide", priority: 0.8, changeFrequency: "monthly" },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" },
  { path: "/faq", priority: 0.7, changeFrequency: "monthly" },
  { path: "/forms", priority: 0.6, changeFrequency: "monthly" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly" },
  { path: "/studio", priority: 0.5, changeFrequency: "monthly" },
  { path: "/magazine", priority: 0.5, changeFrequency: "weekly" },
  { path: "/track", priority: 0.5, changeFrequency: "monthly" },
  { path: "/login", priority: 0.3, changeFrequency: "yearly" },
  { path: "/signup", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
];
const englishPages = ["/", "/dashboard/new", "/apply", "/guide", "/about", "/faq", "/forms", "/support", "/magazine", "/track", "/login", "/signup", "/terms", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getBaseUrl();
  const lastModified = new Date();
  const korean = publicPages.map((page) => ({
    url: new URL(page.path, origin).toString(),
    lastModified, changeFrequency: page.changeFrequency, priority: page.priority,
  }));
  const english = englishPages.map((path) => {
    const base = publicPages.find((page) => page.path === path);
    return {
      url: new URL(path === "/" ? "/en" : `/en${path}`, origin).toString(),
      lastModified, changeFrequency: base?.changeFrequency ?? "monthly" as const,
      priority: Math.max(0.1, (base?.priority ?? 0.5) - 0.1),
    };
  });
  return [...korean, ...english];
}
