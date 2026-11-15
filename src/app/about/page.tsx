import { AboutContent } from "@/components/about/about-content";
import { ABOUT_DESCRIPTION, AboutJsonLd } from "@/components/about/about-json-ld";
import { pageMetadata } from "@/lib/seo";

// 2026-11-16 (owner): the page makes the case for Onside at a glance, and
// carries the whole phrases people search with (음반 심의 대행 …).
export const metadata = pageMetadata({
  title: "왜 온사이드인가 · 음반 심의 대행·뮤직비디오 심의 대행",
  description: ABOUT_DESCRIPTION,
  path: "/about",
  enPath: "/en/about",
});

export default function AboutPage() {
  return (
    <>
      <AboutContent />
      <AboutJsonLd />
    </>
  );
}
