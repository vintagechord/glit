import { pageMetadata } from "@/lib/seo";
export { default } from "@/app/guide/stations/page";

// The locale helpers send every /guide/* link on English pages here. The body
// is the Korean page (translated in the browser), so the canonical stays on
// the Korean page and this alias is not listed in the sitemap.
export const revalidate = 3600;

export const metadata = pageMetadata({
  locale: "en",
  title: "Where We Submit · Korea Media Rating Board, KBS, MBC, SBS and More",
  description: "Every place Onside submits Korean music video and album reviews to: the Korea Media Rating Board, ETN, Mnet and 15 broadcasters, with packages and pricing.",
  path: "/guide/stations",
});
