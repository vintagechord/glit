import { pageMetadata } from "@/lib/seo";
export { default } from "@/app/guide/pricing/page";

// The locale helpers send every /guide/* link on English pages here. The body
// is the Korean page (translated in the browser), so the canonical stays on
// the Korean page and this alias is not listed in the sitemap.
export const revalidate = 3600;

export const metadata = pageMetadata({
  locale: "en",
  title: "Review Pricing · Album and Music Video Reviews",
  description: "Korean broadcast album review packages from 3 to 15 stations and music video review pricing, VAT included, with payment and receipt options.",
  path: "/guide/pricing",
});
