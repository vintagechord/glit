import { pageMetadata } from "@/lib/seo";
export { default } from "@/app/guide/glossary/page";

// The locale helpers send every /guide/* link on English pages here. The body
// is the Korean page (translated in the browser), so the canonical stays on
// the Korean page and this alias is not listed in the sitemap.
export const metadata = pageMetadata({
  locale: "en",
  title: "Review Glossary · Approved, Rejected, Ratings and Certificates",
  description: "Terms used in Korean broadcast album reviews and music video rating classification, explained for first-time applicants.",
  path: "/guide/glossary",
});
