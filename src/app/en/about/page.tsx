import { AboutContent } from "@/components/about/about-content";
import { AboutJsonLd } from "@/components/about/about-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Why Onside · Korean album and music video review submissions",
  description: "Onside, the review brand of Vintage House Co., Ltd., has handled Korean album and music video review submissions since 2017: 15 TV and radio stations and KMRB ratings, applied for and tracked online.",
  path: "/about",
  enPath: "/en/about",
});

export default function EnglishAboutPage() {
  return (
    <>
      <AboutContent english />
      <AboutJsonLd />
    </>
  );
}
