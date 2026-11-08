import { GUIDE_CONTENT_UPDATED } from "@/lib/onside-trust";
import { REVIEW_GUIDES } from "@/lib/review-guides";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import { STATION_GUIDES } from "@/lib/station-guides";
import { getBaseUrl } from "@/lib/url";

// Static feed of the public guides for search engines that accept RSS
// submissions (Naver Search Advisor reads it to find new and changed pages).
// Rebuilt on deploy; the date follows GUIDE_CONTENT_UPDATED.
export const dynamic = "force-static";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PUBLISHED = new Date(`${GUIDE_CONTENT_UPDATED}T00:00:00+09:00`).toUTCString();

export function GET() {
  const origin = getBaseUrl();
  const items = [
    { title: "심의 안내 · 음반 심의·뮤직비디오 심의 절차와 준비물", path: "/guide", description: "음반 심의(TV·라디오 방송국)와 뮤직비디오 심의(온라인·방송국별)의 절차와 준비물을 안내합니다." },
    ...REVIEW_GUIDES.map((guide) => ({ title: guide.title, path: `/guide/${guide.slug}`, description: guide.description })),
    { title: "음반 심의 비용·뮤직비디오 심의 비용 안내", path: "/guide/pricing", description: "음반 심의 방송국 패키지별 비용과 뮤직비디오 심의 항목별 비용, 결제와 증빙, 환불 기준을 안내합니다." },
    { title: "방송국별 심의 안내 · 영등위·KBS·MBC·SBS부터 국악방송까지", path: "/guide/stations", description: "영등위 뮤직비디오 등급분류와 TV·라디오 방송국별 음반 심의·뮤직비디오 심의 안내 목록입니다." },
    ...STATION_GUIDES.map((station) => ({ title: station.title, path: `/guide/stations/${station.slug}`, description: station.description })),
    { title: "심의 용어집 · 적격·부적격·등급분류·필증 뜻", path: "/guide/glossary", description: "음반 심의와 뮤직비디오 심의에서 쓰는 용어를 정리했습니다." },
    { title: "자주 묻는 질문(FAQ)", path: "/faq", description: "음반 심의와 뮤직비디오 심의에 대해 자주 묻는 질문과 답변입니다." },
    { title: "온사이드 회사소개", path: "/about", description: "2017년부터 음반 심의와 뮤직비디오 심의 접수를 대행해 온 온사이드를 소개합니다." },
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
