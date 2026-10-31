import type { Metadata } from "next";
import { Suspense } from "react";
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
import { ScrollRevealObserver } from "@/components/scroll-reveal-observer";
import { ReliableLink } from "@/components/site/reliable-link";
import {
  HomeSessionPanel,
  HomeSessionPanelFallback,
} from "@/features/home/home-session-panel";
import { JsonLd } from "@/components/seo/json-ld";
import { REVIEW_GUIDES } from "@/lib/review-guides";
import {
  organizationJsonLd,
  pageMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  websiteJsonLd,
} from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: `${SITE_NAME} | ${SITE_TAGLINE} · 방송국 심의 대행`,
  absoluteTitle: true,
  description: SITE_DESCRIPTION,
  path: "/",
  enPath: "/en",
});

const heroCtas = [
  {
    title: "심의 신청",
    href: "/dashboard/new",
    visual: "bg-[#1556a4] text-white dark:bg-[#3f8ad8] dark:text-[#06111f]",
    icon: MousePointerClick,
  },
  {
    title: "결과 조회",
    href: "/track",
    visual: "bg-[#f2cf27] text-[#111111] dark:bg-[#f2cf27] dark:text-[#111111]",
    icon: FileText,
  },
];

const scrollRevealBaseClass =
  "opacity-0 translate-y-6 transition-all duration-700 ease-out will-change-transform data-[reveal-state=visible]:opacity-100 data-[reveal-state=visible]:translate-y-0 motion-reduce:opacity-100 motion-reduce:translate-y-0";

const serviceCards = [
  {
    label: "TV · RADIO",
    title: "음반 심의",
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

  return (
    <div
      className={`absolute right-4 top-5 flex h-16 w-16 items-center justify-center rounded-[10px] border-2 shadow-[4px_4px_0_#111111] sm:right-5 sm:top-6 sm:h-20 sm:w-20 ${palette}`}
    >
      <Icon className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={2.4} />
    </div>
  );
}

export default function Home() {
  return (
    <div className="relative overflow-x-hidden">
      <ScrollRevealObserver />

      <section className="w-full -mt-24 pb-4 pt-28 sm:-mt-28 sm:pb-6 sm:pt-36">
        <div className="relative w-full overflow-hidden border-y-2 border-[#111111] bg-[#fffaf0] shadow-[0_24px_80px_rgba(31,41,55,0.12)] dark:border-[#f2cf27] dark:bg-[#101010]">
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#fffaf0_0%,#fffaf0_64%,rgba(242,207,39,0.18)_100%)] dark:bg-[linear-gradient(135deg,#101010_0%,#101010_64%,rgba(242,207,39,0.12)_100%)]" />
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-6 px-4 py-7 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,0.98fr)_minmax(430px,0.92fr)] lg:items-stretch lg:gap-9">
            <div className="flex h-full flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 duration-700 sm:gap-6">
              <div className="space-y-5 sm:space-y-6">
                <span className="bauhaus-kicker" style={{ textTransform: "none" }}>
                  Since 2017
                </span>
                <h1 className="font-display break-keep text-3xl font-black leading-tight text-foreground sm:text-5xl">
                  심의 신청부터
                  <span className="sm:hidden"> </span>
                  <br className="hidden sm:block" />
                  결과 확인까지
                </h1>
                <p className="max-w-xl break-keep text-sm font-semibold leading-7 text-foreground/80 sm:text-base">
                  음반 심의(앨범 심의)와 뮤직비디오 심의를 온라인으로 접수하세요. KBS·MBC·SBS 등 방송국 심의와 라디오 심의, 뮤직비디오 등급분류까지 진행 상황과 결과를 한곳에서 확인합니다.
                </p>
              </div>
              <HomeHeroAdBanner />
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:max-w-[540px] lg:flex-1">
                {heroCtas.map((cta) => {
                  const Icon = cta.icon;
                  return (
                    <ReliableLink
                      key={cta.title}
                      href={cta.href}
                      className="group flex min-h-[166px] flex-col overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white shadow-[6px_6px_0_#111111] transition hover:-translate-y-1 hover:shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[6px_6px_0_#f2cf27] dark:hover:shadow-[8px_8px_0_#f2cf27] sm:min-h-[188px]"
                    >
                      <div
                        className={`flex flex-1 items-center justify-center ${cta.visual}`}
                      >
                        <Icon className="h-12 w-12 sm:h-14 sm:w-14" strokeWidth={2.2} />
                      </div>
                      <div className="px-5 py-3 text-center">
                        <p className="break-keep text-[15px] font-black leading-snug text-foreground dark:text-white sm:text-base">{cta.title}</p>
                      </div>
                    </ReliableLink>
                  );
                })}
              </div>
            </div>

            <Suspense fallback={<HomeSessionPanelFallback />}>
              <HomeSessionPanel />
            </Suspense>
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
          <div>
            <p className="bauhaus-kicker">서비스</p>
            <h2 className="mt-4 text-2xl font-black text-foreground">
              어떤 심의가 필요한가요?
            </h2>
          </div>
          <ReliableLink
            href="https://onside17.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="self-end text-sm font-semibold text-muted-foreground transition hover:text-foreground md:self-auto"
          >
            <span className="inline-flex items-center gap-1.5">
              구버전 접수
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </ReliableLink>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {serviceCards.map((card, index) => (
            <ReliableLink
              key={card.title}
              href={card.href}
              data-scroll-reveal
              data-reveal-state="hidden"
              style={{ transitionDelay: `${120 + index * 120}ms` }}
              className={`group relative min-h-[220px] overflow-hidden rounded-[10px] border-2 p-5 tracking-normal shadow-[8px_8px_0_#111111] transition duration-200 hover:-translate-y-1 hover:shadow-[12px_12px_0_#111111] focus-visible:ring-2 focus-visible:ring-[#111111]/60 dark:shadow-[8px_8px_0_#f2cf27] dark:hover:shadow-[12px_12px_0_#f2cf27] sm:min-h-[236px] sm:p-6 ${scrollRevealBaseClass} ${card.cardClass}`}
            >
              <div className="pointer-events-none absolute inset-0 transition-transform duration-300 group-hover:scale-[1.02]">
                <ServiceCardVisual tone={card.tone} />
              </div>
              <div className="relative z-10 flex min-h-[180px] flex-col pr-16 sm:min-h-[188px] sm:pr-20">
                <p className={`max-w-[10rem] text-[11px] font-black uppercase leading-4 tracking-normal ${card.labelClass}`}>
                  {card.label}
                </p>
                <h3 className="mt-7 max-w-[13rem] break-keep text-3xl font-black leading-none tracking-normal sm:text-4xl">
                  {card.title}
                </h3>
                <div className={`mt-auto inline-flex w-fit items-center gap-2 px-4 py-3 text-sm font-black tracking-normal transition group-hover:translate-x-1 ${card.actionClass}`}>
                  신청 <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </div>
              </div>
            </ReliableLink>
          ))}
        </div>

        <nav aria-label="심의 종류별 안내" className="mt-10 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:p-6">
          <h2 className="text-lg font-black text-foreground">심의 종류별 안내</h2>
          <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">준비물, 비용, 접수 일정과 결과 확인 방법을 심의 종류별로 정리했습니다.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {REVIEW_GUIDES.map((guide) => (
              <li key={guide.slug}>
                <ReliableLink href={`/guide/${guide.slug}`} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]/70">
                  {`${guide.menuLabel} 안내`}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ReliableLink>
              </li>
            ))}
          </ul>
        </nav>
      </section>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
    </div>
  );
}
