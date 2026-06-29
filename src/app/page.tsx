import type { Metadata } from "next";
import {
  Clapperboard,
  Disc3,
  FileText,
  MousePointerClick,
} from "lucide-react";

import { StripAdBanner } from "@/components/site/strip-ad-banner";
import { HomeHeroAdBanner } from "@/components/site/home-hero-ad-banner";
import { ScrollRevealObserver } from "@/components/scroll-reveal-observer";
import { ReliableLink } from "@/components/site/reliable-link";
import { HomeSessionPanel } from "@/features/home/home-session-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: {
      ko: "/",
      en: "/en",
    },
  },
};

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
    label: "방송국별 음반 심의",
    title: "음반 심의",
    description: "TV·라디오 송출용 음원 심의.",
    href: "/dashboard/new/album",
    tone: "album",
    cardClass: "border-[#111111] bg-[#f2cf27] text-[#111111]",
    labelClass: "text-[#111111]/72",
    descriptionClass: "text-[#111111]/78",
    actionClass: "bg-white text-[#111111]",
  },
  {
    label: "온라인 유통/업로드",
    title: "뮤직비디오 온라인 심의",
    description: "유통사 제출·온라인 업로드용.",
    href: "/dashboard/new/mv?type=online",
    tone: "mv",
    cardClass: "border-[#111111] bg-[#1556a4] text-white",
    labelClass: "text-white/74",
    descriptionClass: "text-white/82",
    actionClass: "bg-[#111111] text-white",
  },
  {
    label: "TV 송출 목적",
    title: "뮤직비디오 TV 송출 심의",
    description: "방송국별 조건 확인 후 접수.",
    href: "/dashboard/new/mv?type=broadcast",
    tone: "oneclick",
    cardClass: "border-[#111111] bg-[#d9362c] text-white",
    labelClass: "text-white/74",
    descriptionClass: "text-white/82",
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
                <p className="max-w-xl break-keep text-base font-semibold leading-7 text-foreground/74 dark:text-white/76">
                  음반·뮤직비디오 심의를 온라인으로 접수하고, 진행 현황과 결과 파일을 한 곳에서 확인하세요.
                </p>
              </div>
              <HomeHeroAdBanner />
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:max-w-[540px]">
                {heroCtas.map((cta) => {
                  const Icon = cta.icon;
                  return (
                    <ReliableLink
                      key={cta.title}
                      href={cta.href}
                      className="group flex h-[166px] flex-col overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 hover:shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27] dark:hover:shadow-[8px_8px_0_#f2cf27] sm:h-[188px]"
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
          <div>
            <p className="bauhaus-kicker">신청 유형</p>
            <h2 className="mt-4 text-2xl font-black text-foreground">
              필요한 심의만 선택하세요
            </h2>
          </div>
          <ReliableLink
            href="https://onside17.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="self-end text-sm font-semibold text-muted-foreground transition hover:text-foreground md:self-auto"
          >
            예전 온사이드 페이지에서 접수하기 -&gt;
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
              className={`group relative min-h-[258px] overflow-hidden rounded-[10px] border-2 p-5 tracking-normal shadow-[8px_8px_0_#111111] transition duration-200 hover:-translate-y-1 hover:shadow-[12px_12px_0_#111111] focus-visible:ring-2 focus-visible:ring-[#111111]/60 dark:shadow-[8px_8px_0_#f2cf27] dark:hover:shadow-[12px_12px_0_#f2cf27] sm:min-h-[282px] sm:p-6 ${scrollRevealBaseClass} ${card.cardClass}`}
            >
              <div className="pointer-events-none absolute inset-0 transition-transform duration-300 group-hover:scale-[1.02]">
                <ServiceCardVisual tone={card.tone} />
              </div>
              <div className="relative z-10 flex min-h-[218px] flex-col pr-16 sm:min-h-[234px] sm:pr-20">
                <p className={`max-w-[10rem] text-[11px] font-black uppercase leading-4 tracking-normal ${card.labelClass}`}>
                  {card.label}
                </p>
                <h3 className="mt-7 max-w-[13rem] break-keep text-3xl font-black leading-none tracking-normal sm:text-4xl">
                  {card.title}
                </h3>
                <p className={`mt-4 max-w-[12rem] text-sm font-semibold leading-6 tracking-normal ${card.descriptionClass}`}>
                  {card.description}
                </p>
                <div className={`mt-auto inline-flex w-fit items-center gap-2 px-4 py-3 text-sm font-black tracking-normal transition group-hover:translate-x-1 ${card.actionClass}`}>
                  접수 <span aria-hidden="true">→</span>
                </div>
              </div>
            </ReliableLink>
          ))}
        </div>
      </section>
    </div>
  );
}
