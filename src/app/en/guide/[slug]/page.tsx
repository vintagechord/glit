import { getReviewGuide, REVIEW_GUIDES } from "@/lib/review-guides";
import { pageMetadata } from "@/lib/seo";
export { default } from "@/app/guide/[slug]/page";

// The locale helpers send every /guide/* link on English pages here. The body
// is the Korean guide (translated in the browser), so the canonical stays on
// the Korean page and this alias is not listed in the sitemap.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return REVIEW_GUIDES.map((guide) => ({ slug: guide.slug }));
}

const englishGuideCopy: Record<string, { title: string; description: string }> = {
  "album-review": {
    title: "Album Review Guide · Steps, Pricing and Materials",
    description: "How to apply for Korean broadcast and radio album reviews: steps, required materials, station packages and pricing.",
  },
  "mv-review": {
    title: "Music Video Review Guide · Online Rating and Broadcast Reviews",
    description: "How Korean music video reviews work: online rating classification, broadcast station reviews, materials and pricing.",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getReviewGuide((await params).slug);
  if (!guide) return {};
  const copy = englishGuideCopy[guide.slug] ?? { title: "Review Guide", description: guide.description };
  return pageMetadata({ locale: "en", title: copy.title, description: copy.description, path: `/guide/${guide.slug}` });
}
