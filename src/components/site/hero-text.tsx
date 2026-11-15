"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { ReliableLink } from "@/components/site/reliable-link";
import { estimateHeadlineEm } from "@/lib/home-hero-banners";

/** The English site shows a banner's English text when an administrator entered it. */
export function useHeroEnglish() {
  const pathname = usePathname();
  return pathname === "/en" || pathname.startsWith("/en/");
}

/**
 * A banner headline: two whole lines of real text. `--hero-em` is the width
 * of the longer line in ems (never below the design's own measure), which the
 * stylesheet divides the free width by, so an edited headline still fits.
 */
export function HeroTitle({
  as: Tag,
  ko,
  en,
  floor,
}: {
  as: "h1" | "h2";
  ko: readonly [string, string];
  en: readonly [string, string] | null;
  floor: { ko: number; en: number };
}) {
  const english = useHeroEnglish() && en !== null;
  const lines = english ? en : ko;
  const em = Math.max(english ? floor.en : floor.ko, estimateHeadlineEm(lines));
  return (
    <Tag
      className="onside-hero-title"
      style={{ "--hero-em": em } as React.CSSProperties}
      {...(english ? { lang: "en", "data-hero-lang": "en", "data-no-translate": true } : {})}
    >
      <span>{lines[0]}</span>
      {lines[1] ? <span>{lines[1]}</span> : null}
    </Tag>
  );
}

/** One line of banner text in the visitor's language. */
export function HeroText({ ko, en, className }: { ko: string; en: string | null; className: string }) {
  const english = useHeroEnglish() && en !== null;
  return (
    <p className={className} {...(english ? { lang: "en", "data-hero-lang": "en", "data-no-translate": true } : {})}>
      {english ? en : ko}
    </p>
  );
}

/** A word or two inside a banner graphic (hidden from screen readers by its parent). */
export function HeroWord({ ko, en }: { ko: string; en: string }) {
  return <>{useHeroEnglish() ? en : ko}</>;
}

/**
 * The link that covers a banner. Its name is the headline in the visitor's
 * language, so the English site does not announce a Korean one.
 */
export function HeroLink({ href, ko, en }: { href: string; ko: readonly [string, string]; en: readonly [string, string] | null }) {
  const english = useHeroEnglish() && en !== null;
  return (
    <ReliableLink
      href={href}
      className="onside-hero-link"
      aria-label={(english ? en : ko).filter(Boolean).join(" ")}
      {...(english ? { "data-no-translate-attributes": "aria-label" } : {})}
      {...(/^https:/.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    />
  );
}
