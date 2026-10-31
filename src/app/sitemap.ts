import type { MetadataRoute } from "next";

import { REVIEW_GUIDES } from "@/lib/review-guides";
import { getBaseUrl } from "@/lib/url";

type ChangeFrequency = MetadataRoute.Sitemap[number]["changeFrequency"];
type Page = { path: string; priority: number; changeFrequency: ChangeFrequency; english?: boolean };

// Bump when public page content changes materially; crawlers use it to
// decide what to refetch.
const CONTENT_UPDATED = new Date("2026-11-01T00:00:00+09:00");

const publicPages: Page[] = [
  { path: "/", priority: 1, changeFrequency: "weekly", english: true },
  { path: "/dashboard/new", priority: 0.9, changeFrequency: "weekly", english: true },
  { path: "/dashboard/new/album", priority: 0.9, changeFrequency: "weekly", english: true },
  { path: "/dashboard/new/mv", priority: 0.9, changeFrequency: "weekly", english: true },
  { path: "/guide", priority: 0.9, changeFrequency: "monthly", english: true },
  ...REVIEW_GUIDES.map((guide) => ({ path: `/guide/${guide.slug}`, priority: 0.9, changeFrequency: "monthly" as const })),
  { path: "/faq", priority: 0.8, changeFrequency: "monthly", english: true },
  { path: "/about", priority: 0.7, changeFrequency: "monthly", english: true },
  { path: "/track", priority: 0.6, changeFrequency: "monthly", english: true },
  { path: "/support", priority: 0.6, changeFrequency: "monthly", english: true },
  { path: "/magazine", priority: 0.5, changeFrequency: "weekly", english: true },
  { path: "/forms", priority: 0.4, changeFrequency: "monthly", english: true },
  { path: "/login", priority: 0.3, changeFrequency: "yearly", english: true },
  { path: "/signup", priority: 0.3, changeFrequency: "yearly", english: true },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly", english: true },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly", english: true },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getBaseUrl();
  const url = (path: string) => new URL(path, origin).toString();
  const englishPath = (path: string) => (path === "/" ? "/en" : `/en${path}`);
  return publicPages.flatMap((page) => {
    const languages = page.english ? { ko: url(page.path), en: url(englishPath(page.path)) } : undefined;
    const korean = {
      url: url(page.path), lastModified: CONTENT_UPDATED, changeFrequency: page.changeFrequency, priority: page.priority,
      ...(languages ? { alternates: { languages } } : {}),
    };
    if (!page.english) return [korean];
    return [korean, {
      url: url(englishPath(page.path)), lastModified: CONTENT_UPDATED, changeFrequency: page.changeFrequency,
      priority: Math.max(0.1, Math.round((page.priority - 0.2) * 10) / 10), alternates: { languages },
    }];
  });
}
