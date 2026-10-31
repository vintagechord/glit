import type { Metadata } from "next";

import { APP_CONFIG } from "@/lib/config";
import { getBaseUrl } from "@/lib/url";

export const SITE_NAME = "온사이드";
export const SITE_NAME_EN = "Onside";
export const SITE_TAGLINE = "음반심의·뮤직비디오 심의 온라인 접수";
export const SITE_DESCRIPTION =
  "음반심의(앨범심의)와 뮤직비디오(뮤비) 심의를 온라인으로 한 번에 접수하세요. KBS·MBC·SBS 등 방송국 심의와 라디오 심의, 영상물등급위원회 뮤직비디오 등급분류까지 2017년부터 심의를 대행해 온 온사이드가 진행 상황과 결과를 안내합니다.";
export const SITE_DESCRIPTION_EN =
  "Submit Korean broadcast music reviews online: album reviews for KBS, MBC, SBS and radio stations, and music video reviews and ratings. Onside has handled review submissions since 2017.";

/** Search terms people use for the services Onside provides. */
export const SEO_KEYWORDS = [
  "음반심의", "음반 심의", "앨범심의", "앨범 심의", "뮤직비디오심의", "뮤직비디오 심의", "뮤비심의", "뮤비 심의",
  "방송국심의", "방송국 심의", "방송심의", "라디오심의", "라디오 심의", "가요심의", "음원심의", "음원 방송 심의",
  "KBS 심의", "MBC 심의", "SBS 심의", "뮤직비디오 등급분류", "영상물등급위원회 뮤직비디오", "심의 대행", "음반심의 대행",
];

/** Built from src/app/opengraph-image.tsx at deploy time. */
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "온사이드 — 음반심의·뮤직비디오 심의 온라인 접수" };

type PageMetadataInput = {
  title: string;
  description: string;
  /** Path of the Korean page, e.g. "/guide/album-review". */
  path: string;
  /** English counterpart, when one exists. */
  enPath?: string | null;
  locale?: "ko" | "en";
  keywords?: string[];
  noindex?: boolean;
  /** Use the title as-is (skip the "| 온사이드" template). */
  absoluteTitle?: boolean;
};

/** Canonical, hreflang, Open Graph and Twitter metadata for one page. */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const locale = input.locale ?? "ko";
  const canonical = locale === "en" && input.enPath ? input.enPath : input.path;
  const languages: Record<string, string> = { ko: input.path, "x-default": input.path };
  if (input.enPath) languages.en = input.enPath;
  const siteName = locale === "en" ? SITE_NAME_EN : SITE_NAME;
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    ...(input.keywords ? { keywords: input.keywords } : {}),
    alternates: { canonical, languages },
    openGraph: {
      type: "website",
      siteName,
      locale: locale === "en" ? "en_US" : "ko_KR",
      url: canonical,
      title: input.absoluteTitle ? input.title : `${input.title} | ${siteName}`,
      description: input.description,
      // Page-level openGraph replaces the root one, so attach the share image here.
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: input.absoluteTitle ? input.title : `${input.title} | ${siteName}`,
      description: input.description,
      images: [OG_IMAGE.url],
    },
    ...(input.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export const absoluteUrl = (path: string) => new URL(path, getBaseUrl()).toString();

/** Organization + local business facts shared by every structured-data block. */
export function organizationJsonLd() {
  const origin = getBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    alternateName: [SITE_NAME_EN, "온사이드 심의", "iamonside"],
    legalName: APP_CONFIG.businessName,
    url: origin,
    logo: absoluteUrl("/brand-logo.png"),
    image: absoluteUrl("/opengraph-image"),
    description: SITE_DESCRIPTION,
    foundingDate: "2017",
    email: APP_CONFIG.supportEmail,
    telephone: APP_CONFIG.supportPhone,
    taxID: APP_CONFIG.businessRegNo,
    address: {
      "@type": "PostalAddress",
      streetAddress: APP_CONFIG.businessAddress,
      addressCountry: "KR",
    },
    areaServed: { "@type": "Country", name: "대한민국" },
    knowsAbout: ["음반 심의", "뮤직비디오 심의", "방송국 심의", "라디오 심의", "뮤직비디오 등급분류"],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      telephone: APP_CONFIG.supportPhone,
      email: APP_CONFIG.supportEmail,
      availableLanguage: ["Korean", "English"],
    },
  };
}

export function websiteJsonLd() {
  const origin = getBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: SITE_NAME,
    alternateName: SITE_NAME_EN,
    url: origin,
    inLanguage: ["ko-KR", "en"],
    publisher: { "@id": `${origin}/#organization` },
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqJsonLd(items: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function serviceJsonLd(input: {
  name: string;
  serviceType: string;
  description: string;
  path: string;
  offers: Array<{ name: string; priceKrw: number }>;
}) {
  const origin = getBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: input.name,
    serviceType: input.serviceType,
    description: input.description,
    url: absoluteUrl(input.path),
    provider: { "@id": `${origin}/#organization` },
    areaServed: { "@type": "Country", name: "대한민국" },
    offers: input.offers.map((offer) => ({
      "@type": "Offer",
      name: offer.name,
      price: offer.priceKrw,
      priceCurrency: "KRW",
      url: absoluteUrl(input.path),
      availability: "https://schema.org/InStock",
    })),
  };
}

/** Serialize JSON-LD safely inside a <script> tag. */
export const jsonLdString = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
