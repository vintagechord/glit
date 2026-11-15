import { JsonLd } from "@/components/seo/json-ld";
import { ONSIDE_WHY_FAQS } from "@/lib/onside-why";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, organizationJsonLd } from "@/lib/seo";
import { getBaseUrl } from "@/lib/url";

export const ABOUT_TITLE = "왜 온사이드인가 · 음반 심의 대행·뮤직비디오 심의 대행";
export const ABOUT_DESCRIPTION =
  "음반 심의 대행과 뮤직비디오 심의 대행을 2017년부터 이어온 온사이드. 비트마켓 워터멜론, 아트상품 스토어 아트멜론, 뮤직 스튜디오 빈티지하우스, 수리 전문점 마하픽스를 운영하는 (주)빈티지하우스의 심의 브랜드로, TV·라디오 방송국 15곳과 영등위 심의를 온라인으로 접수하고 진행 상황과 결과를 한곳에서 안내합니다.";

/** The "who is this" blocks search engines and AI assistants quote. */
export function AboutJsonLd() {
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          "@id": `${absoluteUrl("/about")}#webpage`,
          url: absoluteUrl("/about"),
          name: ABOUT_TITLE,
          description: ABOUT_DESCRIPTION,
          inLanguage: "ko-KR",
          isPartOf: { "@id": `${getBaseUrl()}/#website` },
          mainEntity: { "@id": `${getBaseUrl()}/#organization` },
        }}
      />
      <JsonLd data={faqJsonLd(ONSIDE_WHY_FAQS)} />
      <JsonLd data={breadcrumbJsonLd([{ name: "온사이드", path: "/" }, { name: "회사소개", path: "/about" }])} />
    </>
  );
}
