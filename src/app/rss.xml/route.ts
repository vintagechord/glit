import { REVIEW_GUIDES } from "@/lib/review-guides";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import { getBaseUrl } from "@/lib/url";

// Static feed of the public review guides for search engines that accept RSS
// submissions (Naver Search Advisor). Rebuilt on deploy.
export const dynamic = "force-static";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PUBLISHED = new Date("2026-11-01T00:00:00+09:00").toUTCString();

export function GET() {
  const origin = getBaseUrl();
  const items = [
    { title: "심의 안내 · 음반 심의·뮤직비디오 심의 절차와 준비물", path: "/guide", description: "음반 심의, 뮤직비디오 심의, 방송국 심의, 라디오 심의의 절차와 준비물을 안내합니다." },
    ...REVIEW_GUIDES.map((guide) => ({ title: guide.title, path: `/guide/${guide.slug}`, description: guide.description })),
    { title: "자주 묻는 질문(FAQ)", path: "/faq", description: "음반 심의와 뮤직비디오 심의에 대해 자주 묻는 질문과 답변입니다." },
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(`${SITE_NAME} 심의 가이드`)}</title>
<link>${origin}/guide</link>
<description>${escapeXml(SITE_DESCRIPTION)}</description>
<language>ko</language>
<atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>
${items.map((item) => `<item>
<title>${escapeXml(item.title)}</title>
<link>${origin}${item.path}</link>
<guid isPermaLink="true">${origin}${item.path}</guid>
<description>${escapeXml(item.description)}</description>
<pubDate>${PUBLISHED}</pubDate>
</item>`).join("\n")}
</channel>
</rss>
`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
