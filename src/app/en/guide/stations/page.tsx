import { pageMetadata } from "@/lib/seo";
export { default } from "@/app/guide/stations/page";

// The locale helpers send every /guide/* link on English pages here. The body
// is the Korean page (translated in the browser), so the canonical stays on
// the Korean page and this alias is not listed in the sitemap.
export const revalidate = 3600;

export const metadata = pageMetadata({
  locale: "en",
  title: "Broadcasters We Submit To · KBS, MBC, SBS and 14 More",
  description: "Every Korean broadcaster Onside submits album reviews and music video reviews to, with the packages that include each station.",
  path: "/guide/stations",
});
