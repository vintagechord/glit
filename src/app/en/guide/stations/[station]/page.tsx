import { pageMetadata } from "@/lib/seo";
import { getStationGuide, STATION_GUIDES } from "@/lib/station-guides";
export { default } from "@/app/guide/stations/[station]/page";

// The locale helpers send every /guide/* link on English pages here. The body
// is the Korean station guide (translated in the browser), so the canonical
// stays on the Korean page and this alias is not listed in the sitemap.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return STATION_GUIDES.map((guide) => ({ station: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ station: string }> }) {
  const guide = getStationGuide((await params).station);
  if (!guide) return {};
  const kinds = [guide.album ? "Album Review" : "", guide.mv ? "Music Video Review" : ""].filter(Boolean).join(" and ");
  return pageMetadata({
    locale: "en",
    title: `${guide.englishName ?? guide.shortName} ${kinds} · How to Apply and Pricing`,
    description: `How to submit a ${kinds.toLowerCase()} to ${guide.englishName ?? guide.name} in Korea through Onside: packages, pricing, materials and results.`,
    path: `/guide/stations/${guide.slug}`,
  });
}
