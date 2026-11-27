import type { Metadata } from "next";
import {
  ArrowRight,
  Clapperboard,
  Disc3,
  ExternalLink,
  FileText,
  MousePointerClick,
} from "lucide-react";

import { StripAdBanner } from "@/components/site/strip-ad-banner";
import { HomeHeroAdBanner } from "@/components/site/home-hero-ad-banner";
import { HomeHeroBanner } from "@/components/site/home-hero-banner";
import { getHomeHero } from "@/lib/public-home-hero";
import { ScrollRevealObserver } from "@/components/scroll-reveal-observer";
import { ReliableLink } from "@/components/site/reliable-link";
import { HomeSessionPanel } from "@/features/home/home-session-panel";
import { JsonLd } from "@/components/seo/json-ld";
import { ALBUM_MULTI_DISCOUNT_BADGE } from "@/lib/album-payment-discount";
import { ONSIDE_WHY_PATH } from "@/lib/onside-why";
import { GUIDE_TOPIC_LINKS } from "@/lib/review-guide-links";
import { REVIEW_GUIDES } from "@/lib/review-guides";
import {
  organizationJsonLd,
  pageMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
  websiteJsonLd,
} from "@/lib/seo";

// Served from the CDN for an hour at a time: a stale copy costs a round trip
// to the function region, so the window is long. Banner, package and setting
// edits revalidate "/" at once, and the visitor's own status loads in the
// browser.
export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  // Naver ranks the home page for the review terms, so every one people
  // search with (음반·음원·앨범·뮤직비디오 심의, 대행) sits in the title or
  // the description.
  // 2026-11-16: "음반 심의 대행" and "뮤직비디오 심의 대행" each stay whole,
  // the way people type them (음반심의대행).
  title: `${SITE_NAME} | 음반 심의 대행 · 뮤직비디오 심의 대행 · 음원 심의 온라인 접수`,
  absoluteTitle: true,
  description: SITE_DESCRIPTION,
  path: "/",
  enPath: "/en",
});

// 심의 신청 is the main action: solid yellow with the deeper shadow.
// 결과 조회 stays white with a black border, a step quieter beside it.
// In the hero column only these action cards carry an offset shadow; the
// banner and the service card above sit flat on the same thin line.
// 2026-11-11 (owner): the banner lost 38px on phones and 66px from 640px up
// when the turntable moved beside the headline; the cards took that height
// (68→106px, 80→146px).
const heroCtas = [
  {
    title: "심의 신청",
    href: "/dashboard/new",
    cardClass:
      "bg-[#f2cf27] text-[#111111] shadow-[4px_4px_0_#111111] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[4px_4px_0_#ffffff] dark:hover:shadow-[5px_5px_0_#ffffff]",
    icon: MousePointerClick,
  },
  {
    title: "결과 조회",
    href: "/track",
    cardClass:
      "bg-white text-[#111111] shadow-[2px_2px_0_#111111] hover:shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[2px_2px_0_#f2cf27] dark:hover:shadow-[3px_3px_0_#f2cf27]",
    icon: FileText,
  },
];

// Hidden only while scripts run (data-js comes from the inline layout script)
// and motion is welcome, so visitors without JavaScript still see the section.
const scrollRevealBaseClass =
  "transition-all duration-700 ease-out will-change-transform motion-safe:[html[data-js]_&[data-reveal-state=hidden]]:opacity-0 motion-safe:[html[data-js]_&[data-reveal-state=hidden]]:translate-y-6 motion-reduce:transition-none";

const serviceCards = [
  {
    label: "TV · RADIO",
    title: "음반 심의",
    // 2026-11-14 (owner): albums ordered together are half price from the second.
    badge: ALBUM_MULTI_DISCOUNT_BADGE,
    href: "/dashboard/new/album",
    tone: "album",
    cardClass: "border-[#111111] bg-[#f2cf27] text-[#111111]",
    labelClass: "text-[#111111]/72",
    actionClass: "bg-white text-[#111111]",
  },
  {
    label: "유통 · 업로드",
    title: "MV 온라인",
    href: "/dashboard/new/mv?type=distribution",
    tone: "mv",
    cardClass: "border-[#111111] bg-[#1556a4] text-white",
    labelClass: "text-white/74",
    actionClass: "bg-[#111111] text-white",
  },
  {
    label: "TV 송출",
    title: "MV 방송",
    href: "/dashboard/new/mv?type=broadcast",
    tone: "oneclick",
    cardClass: "border-[#111111] bg-[#d9362c] text-white",
    labelClass: "text-white/74",
    actionClass: "bg-white text-[#111111]",
  },
];

function ServiceCardVisual({ tone }: { tone: string }) {
  const Icon =
    tone === "album" ? Disc3 : tone === "mv" ? Clapperboard : MousePointerClick;
  const palette =
    tone === "album"
      ? "border-[#111111] bg-white text-[#111111]"
      : tone === "mv"
        ? "border-white bg-[#111111] text-white"
        : "border-[#111111] bg-white text-[#111111]";

  // Beside the title in the phone and tablet row; in the card's top-right
  // corner from lg.
  return (
    <span
      aria-hidden="true"
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 shadow-[3px_3px_0_#111111] transition-transform duration-300 group-hover:scale-[1.04] lg:absolute lg:right-5 lg:top-5 lg:h-16 lg:w-16 lg:rounded-[10px] lg:shadow-[4px_4px_0_#111111] ${palette}`}
    >
      <Icon className="h-6 w-6 lg:h-8 lg:w-8" strokeWidth={2.4} />
    </span>
  );
}

export default async function Home() {
  // The banners set under 메인 배너 관리; saving there revalidates this page.
  const hero = await getHomeHero();
  return (
    <div className="relative overflow-x-hidden">
      <ScrollRevealObserver />

      <section className="w-full -mt-24 pb-4 pt-28 sm:-mt-28 sm:pb-6 sm:pt-36">
        <div className="relative w-full overflow-hidden border-y-2 border-[#111111] bg-[#fffaf0] shadow-[0_24px_80px_rgba(31,41,55,0.12)] dark:border-[#f2cf27] dark:bg-[#101010]">
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#fffaf0_0%,#fffaf0_64%,rgba(242,207,39,0.18)_100%)] dark:bg-[linear-gradient(135deg,#101010_0%,#101010_64%,rgba(242,207,39,0.12)_100%)]" />
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-6 px-4 py-7 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,0.98fr)_minmax(430px,0.92fr)] lg:items-stretch lg:gap-9">
            <div className="flex h-full flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300 sm:gap-5">
              {/* A short carousel. The brand banner's headline carries the two
                  service names search engines and AI assistants match on and
                  is the page's h1 (음반·뮤직비디오 심의, 이제 더 간편하게: the
                  owner's promise, 2026-11-11). */}
              <HomeHeroBanner slides={hero.slides} intervalSeconds={hero.intervalSeconds} />
              <HomeHeroAdBanner />
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:max-w-[540px]">
                {heroCtas.map((cta) => {
                  const Icon = cta.icon;
                  return (
                    <ReliableLink
                      key={cta.title}
                      href={cta.href}
                      className={`group flex min-h-[106px] items-center justify-center gap-2.5 rounded-[10px] border-[1.5px] border-[#111111] px-3 transition hover:-translate-y-0.5 sm:min-h-[146px] sm:gap-3 ${cta.cardClass}`}
                    >
                      <Icon className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" strokeWidth={2.3} aria-hidden="true" />
                      <span className="break-keep text-base font-black leading-snug sm:text-lg">{cta.title}</span>
                    </ReliableLink>
                  );
                })}
              </div>
            </div>

            <HomeSessionPanel />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-2 sm:px-6">
        <div className="mb-10">
          <StripAdBanner />
        </div>

        <div
          data-scroll-reveal
          data-reveal-state="hidden"
          className={`flex flex-col gap-4 md:flex-row md:items-end md:justify-between ${scrollRevealBaseClass}`}
          style={{ transitionDelay: "0ms" }}
        >
          {/* 2026-11-27 (owner): the 「서비스」 badge above the heading was removed. */}
          <h2 className="text-2xl font-black text-foreground">
            어떤 심의가 필요한가요?
          </h2>
          <ReliableLink
            href="https://onside17.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="self-end text-sm font-semibold text-muted-foreground transition hover:text-foreground md:self-auto"
          >
            <span className="inline-flex items-center gap-1.5">
              Legacy 사이트 접수
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </ReliableLink>
        </div>

        {/* 2026-11-25 (owner): three 224px cards filled a phone screen, so below
            lg (phones and tablets) each service is one row (icon · name · 신청);
            from lg the three cards stay side by side, a little shorter. */}
        <div className="mt-8 grid gap-4 lg:grid-cols-3 lg:gap-6">
          {serviceCards.map((card, index) => (
            <ReliableLink
              key={card.title}
              href={card.href}
              data-scroll-reveal
              data-reveal-state="hidden"
              style={{ transitionDelay: `${120 + index * 120}ms` }}
              className={`group relative flex min-h-[80px] items-center gap-3.5 rounded-[10px] border-2 px-4 py-3.5 tracking-normal shadow-[4px_4px_0_#111111] transition duration-200 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#111111] focus-visible:ring-2 focus-visible:ring-[#111111]/60 dark:shadow-[4px_4px_0_#f2cf27] dark:hover:shadow-[6px_6px_0_#f2cf27] lg:min-h-[192px] lg:flex-col lg:items-stretch lg:gap-0 lg:p-6 lg:shadow-[8px_8px_0_#111111] lg:hover:-translate-y-1 lg:hover:shadow-[12px_12px_0_#111111] lg:dark:shadow-[8px_8px_0_#f2cf27] lg:dark:hover:shadow-[12px_12px_0_#f2cf27] ${scrollRevealBaseClass} ${card.cardClass}`}
            >
              {"badge" in card && card.badge ? (
                // On the top edge by the right corner, as on the application
                // page: it takes no line of its own and clears the icon tile.
                <span className="absolute -top-3.5 right-4 z-20 rounded-[6px] border-2 border-[#111111] bg-[#d9362c] px-2.5 py-1.5 text-xs font-black leading-none text-white shadow-[2px_2px_0_#111111] sm:right-5 sm:text-sm">
                  {card.badge}
                </span>
              ) : null}
              <ServiceCardVisual tone={card.tone} />
              <div className="min-w-0 flex-1 lg:flex-none lg:pb-4 lg:pr-20">
                <p className={`text-[11px] font-black uppercase leading-4 tracking-normal ${card.labelClass}`}>
                  {card.label}
                </p>
                <h3 className="mt-1 break-keep text-xl font-black leading-tight tracking-normal lg:mt-5 lg:text-3xl lg:leading-none xl:text-4xl">
                  {card.title}
                </h3>
              </div>
              <div className={`inline-flex w-fit shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-black tracking-normal transition group-hover:translate-x-1 lg:mt-auto lg:gap-2 lg:px-4 lg:py-3 ${card.actionClass}`}>
                신청 <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </div>
            </ReliableLink>
          ))}
        </div>

        <nav aria-label="심의 종류별 안내" className="mt-10 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:p-6">
          <h2 className="text-lg font-black text-foreground">심의 종류별 안내</h2>
          <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">음반 심의 대행과 뮤직비디오 심의 대행에 필요한 준비물, 비용, 접수 일정과 결과 확인 방법을 정리했습니다.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {REVIEW_GUIDES.map((guide) => (
              <li key={guide.slug}>
                <ReliableLink href={`/guide/${guide.slug}`} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]/70">
                  {`${guide.menuLabel} 안내`}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ReliableLink>
              </li>
            ))}
            {GUIDE_TOPIC_LINKS.map((topic) => (
              <li key={topic.path}>
                <ReliableLink href={topic.path} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]/70">
                  {topic.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ReliableLink>
              </li>
            ))}
            {/* 2026-11-16 (owner): few visitors reach the footer's 회사소개, so the
                case for Onside is linked from here and from the main banner. */}
            <li>
              <ReliableLink href={ONSIDE_WHY_PATH} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]/70">
                왜 온사이드인가<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ReliableLink>
            </li>
          </ul>
        </nav>
      </section>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
    </div>
  );
}
