import Link from "next/link";
import {
  CheckCircle2,
  Clapperboard,
  CreditCard,
  Disc3,
  FileText,
  MousePointerClick,
  Play,
} from "lucide-react";

import { StripAdBanner } from "@/components/site/strip-ad-banner";
import { ScrollRevealObserver } from "@/components/scroll-reveal-observer";
import { HomeArtistSpotlight } from "@/features/home/home-artist-spotlight";
import { HomeSessionPanel } from "@/features/home/home-session-panel";
import { OscilloscopeCurtainBackground } from "@/features/home/oscilloscope-curtain-background";

const heroCtas = [
  {
    title: "음반 심의 신청",
    href: "/dashboard/new/album",
    visual: "from-[#f2cf27] via-[#fffaf0] to-[#1556a4]",
    icon: (
      <svg
        viewBox="0 0 160 120"
        className="h-20 w-20 drop-shadow-[0_14px_30px_rgba(59,130,246,0.35)] sm:h-24 sm:w-24"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="albumSleeve" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e0f2ff" />
            <stop offset="100%" stopColor="#b8d9ff" />
          </linearGradient>
          <linearGradient id="albumDisc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6aa9ff" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <rect
          x="18"
          y="20"
          width="72"
          height="80"
          rx="18"
          fill="url(#albumSleeve)"
        />
        <rect
          x="28"
          y="30"
          width="52"
          height="60"
          rx="14"
          fill="#ffffff"
          opacity="0.65"
        />
        <circle cx="112" cy="60" r="28" fill="url(#albumDisc)" />
        <circle cx="112" cy="60" r="10" fill="#f8fbff" opacity="0.9" />
        <circle cx="112" cy="60" r="4" fill="#dbeafe" />
      </svg>
    ),
  },
  {
    title: "뮤직비디오 심의 신청",
    href: "/dashboard/new/mv",
    visual: "from-[#1556a4] via-[#111111] to-[#d9362c]",
    icon: (
      <svg
        viewBox="0 0 160 120"
        className="h-20 w-20 drop-shadow-[0_14px_30px_rgba(99,102,241,0.35)] sm:h-24 sm:w-24"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mvScreen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="mvPlay" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <rect x="18" y="22" width="124" height="76" rx="20" fill="url(#mvScreen)" />
        <rect x="28" y="32" width="104" height="56" rx="16" fill="#ffffff" opacity="0.18" />
        <polygon points="76,44 76,76 104,60" fill="url(#mvPlay)" />
        <circle cx="124" cy="36" r="6" fill="#ffffff" opacity="0.35" />
      </svg>
    ),
  },
];

const featureHighlights = [
  {
    title: "실시간 진행 알림",
    description:
      "방송국별 심의 진행 상황을 실시간으로 확인하세요.\n회원/비회원 누구나",
    card:
      "bg-[#fffaf0] text-[#111111] border-[#111111] shadow-[5px_5px_0_#111111] dark:bg-[#171717] dark:text-[#f5f5f7] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]",
    visual: "from-[#f2cf27] via-white to-[#1556a4]",
    icon: (
      <svg
        viewBox="0 0 96 96"
        className="h-16 w-16 drop-shadow-[0_12px_24px_rgba(59,130,246,0.35)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="signalOrb" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9ecbff" />
            <stop offset="100%" stopColor="#4f7cff" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="52" r="18" fill="url(#signalOrb)" />
        <path
          d="M28 52a20 20 0 0 1 40 0"
          fill="none"
          stroke="#7db0ff"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d="M20 52a28 28 0 0 1 56 0"
          fill="none"
          stroke="#7db0ff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.35"
        />
        <circle cx="48" cy="52" r="4" fill="#ffffff" opacity="0.9" />
      </svg>
    ),
  },
  {
    title: "파일 업로드",
    description:
      "온사이드는 자체 스토리지 운영으로 안전하게 음원과 영상을 관리합니다.",
    card:
      "bg-white text-[#111111] border-[#111111] shadow-[5px_5px_0_#111111] dark:bg-[#171717] dark:text-[#f5f5f7] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]",
    visual: "from-[#1f7a5a] via-white to-[#f2cf27]",
    icon: (
      <svg
        viewBox="0 0 96 96"
        className="h-16 w-16 drop-shadow-[0_12px_24px_rgba(16,185,129,0.3)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="uploadCloud" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a7f3d0" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle cx="34" cy="52" r="14" fill="url(#uploadCloud)" />
        <circle cx="52" cy="44" r="16" fill="url(#uploadCloud)" />
        <circle cx="70" cy="52" r="14" fill="url(#uploadCloud)" />
        <rect x="24" y="52" width="56" height="18" rx="9" fill="url(#uploadCloud)" />
        <path d="M48 30v26" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M38 40l10-10 10 10"
          fill="none"
          stroke="#0f172a"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "관리자 승인",
    description:
      "접수 시 1차 체크, 방송국 전달 전 2차 검수로 빈틈 없이",
    card:
      "bg-[#f2cf27] text-[#111111] border-[#111111] shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]",
    visual: "from-[#d9362c] via-white to-[#f2cf27]",
    icon: (
      <svg
        viewBox="0 0 96 96"
        className="h-16 w-16 drop-shadow-[0_12px_24px_rgba(245,158,11,0.3)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="shieldCore" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <path
          d="M48 12l26 10v22c0 16-10 30-26 36-16-6-26-20-26-36V22z"
          fill="url(#shieldCore)"
        />
        <path
          d="M34 48l10 10 18-18"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const scrollRevealBaseClass =
  "opacity-0 translate-y-6 transition-all duration-700 ease-out will-change-transform data-[reveal-state=visible]:opacity-100 data-[reveal-state=visible]:translate-y-0 motion-reduce:opacity-100 motion-reduce:translate-y-0";

const serviceCards = [
  {
    label: "Broadcast Review Submission",
    title: "음반 심의",
    description: "트랙 정보 입력과 음원 파일 업로드까지 한 번에.",
    href: "/dashboard/new/album",
    tone: "album",
    cardClass: "border-[#111111] bg-[#f2cf27] text-[#111111]",
    labelClass: "text-[#111111]/72",
    descriptionClass: "text-[#111111]/78",
    actionClass: "bg-white text-[#111111]",
  },
  {
    label: "M/V Review",
    title: "M/V 심의",
    description: "TV 송출/온라인 업로드 심의를 분리해 효율적으로.",
    href: "/dashboard/new/mv",
    tone: "mv",
    cardClass: "border-[#111111] bg-[#1556a4] text-white",
    labelClass: "text-white/74",
    descriptionClass: "text-white/82",
    actionClass: "bg-[#111111] text-white",
  },
  {
    label: "One Click",
    title: "원클릭 접수",
    description: "멜론 링크와 음원 파일만 제출하는 음반 전용 간편 접수.",
    href: "/dashboard/new/album?mode=oneclick",
    tone: "oneclick",
    cardClass: "border-[#111111] bg-[#d9362c] text-white",
    labelClass: "text-white/74",
    descriptionClass: "text-white/82",
    actionClass: "bg-white text-[#111111]",
  },
];

const processSteps = [
  {
    label: "패키지 선택",
    tone: "bg-[#f2cf27] text-[#111111]",
    icon: Disc3,
  },
  {
    label: "신청서 작성",
    tone: "bg-white text-[#111111]",
    icon: FileText,
  },
  {
    label: "결제하기",
    tone: "bg-[#1556a4] text-white",
    icon: CreditCard,
  },
  {
    label: "접수 완료",
    tone: "bg-[#d9362c] text-white",
    icon: CheckCircle2,
  },
];

function ServiceCardVisual({ tone }: { tone: string }) {
  if (tone === "album") {
    return (
      <div className="absolute right-4 top-5 flex h-24 w-24 items-center justify-center rounded-[12px] border-2 border-[#111111] bg-white shadow-[5px_5px_0_#111111] sm:right-5 sm:top-6 sm:h-28 sm:w-28">
        <div className="absolute -left-5 top-5 h-16 w-16 rounded-full border-[10px] border-[#1556a4] bg-[#111111] sm:-left-6 sm:h-20 sm:w-20">
          <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </div>
        <Disc3 className="relative z-10 h-12 w-12 text-[#111111] sm:h-14 sm:w-14" strokeWidth={2.3} />
      </div>
    );
  }

  if (tone === "mv") {
    return (
      <div className="absolute right-4 top-5 flex h-24 w-28 flex-col overflow-hidden rounded-[12px] border-2 border-white/95 bg-[#111111] shadow-[5px_5px_0_rgba(17,17,17,0.75)] sm:right-5 sm:top-6 sm:h-28 sm:w-32">
        <div className="flex h-8 items-center gap-1 border-b-2 border-white/90 bg-white px-2 text-[#111111]">
          <Clapperboard className="h-4 w-4" strokeWidth={2.4} />
          <span className="text-[9px] font-black uppercase tracking-normal">Preview</span>
        </div>
        <div className="relative flex flex-1 items-center justify-center bg-[linear-gradient(135deg,#111111,#243b5a)]">
          <div className="absolute bottom-2 left-2 h-2 w-10 rounded-full bg-white/30" />
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f2cf27] text-[#111111]">
            <Play className="ml-0.5 h-5 w-5 fill-current" strokeWidth={2.4} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-4 top-5 flex h-24 w-24 items-center justify-center rounded-[12px] border-2 border-white/95 bg-white text-[#111111] shadow-[5px_5px_0_#111111] sm:right-5 sm:top-6 sm:h-28 sm:w-28">
      <FileText className="absolute left-4 top-4 h-10 w-10 text-[#1556a4] sm:h-12 sm:w-12" strokeWidth={2.2} />
      <CheckCircle2 className="absolute right-4 top-4 h-8 w-8 text-[#d9362c] sm:h-9 sm:w-9" strokeWidth={2.5} />
      <MousePointerClick className="absolute bottom-4 right-5 h-11 w-11 text-[#111111] sm:h-12 sm:w-12" strokeWidth={2.3} />
    </div>
  );
}

export default function Home() {
  return (
    <div className="relative overflow-x-hidden">
      <ScrollRevealObserver />
      <div aria-hidden="true" className="pointer-events-none absolute left-0 top-24 h-5 w-40 bg-[#f2cf27]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-0 top-48 h-16 w-16 bg-[#d9362c]" />
      <div aria-hidden="true" className="pointer-events-none absolute bottom-20 left-[8%] h-8 w-32 bg-[#1556a4]" />

      <section className="w-full -mt-24 pb-8 pt-28 sm:-mt-28 sm:pb-10 sm:pt-36">
        <div className="relative w-full overflow-hidden border-y-2 border-[#111111] bg-[#fffaf0] shadow-[0_24px_80px_rgba(31,41,55,0.12)] dark:border-[#f2cf27] dark:bg-[#101010]">
          <div className="absolute inset-0">
            <OscilloscopeCurtainBackground />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,250,240,0.86),rgba(255,250,240,0.42),transparent)] dark:bg-[linear-gradient(90deg,rgba(16,16,16,0.9),rgba(16,16,16,0.52),transparent)]" />
            <div aria-hidden="true" className="absolute right-0 top-0 h-20 w-20 bg-[#f2cf27]" />
            <div aria-hidden="true" className="absolute right-20 top-20 hidden h-10 w-28 bg-[#1556a4] sm:block" />
            <div aria-hidden="true" className="absolute bottom-0 left-0 h-6 w-full bg-[#111111] dark:bg-[#f2cf27]" />
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 duration-700 sm:gap-6 lg:min-h-[520px] lg:h-full">
              <span className="bauhaus-kicker">
                OFFICIAL MUSIC & VIDEO CLEARANCE
              </span>
              <h1 className="font-display break-keep text-3xl font-black leading-tight text-foreground sm:text-5xl">
                음반 · M/V 심의를 쉽고 빠르게!
              </h1>
              <div className="max-w-xl rounded-[10px] border-2 border-[#111111] bg-white px-5 py-4 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
                <p className="text-[13px] font-semibold leading-6 text-foreground/82 sm:text-[15px] dark:text-white/84">
                  온사이드에서 방송사별 심의 진행을 실시간으로 받아보세요.
                </p>
                <p className="mt-2 text-[13px] font-semibold leading-6 text-foreground/72 sm:text-[15px] dark:text-white/74">
                  나의 모든 심의 기록, 온사이드에서 모아 관리할 수 있습니다.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {heroCtas.map((cta) => (
                  <Link
                    key={cta.title}
                    href={cta.href}
                    className="group overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 hover:shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27] dark:hover:shadow-[8px_8px_0_#f2cf27]"
                  >
                    <div
                      className={`relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br sm:h-32 ${cta.visual}`}
                    >
                      <div className="absolute left-0 top-0 h-5 w-24 bg-[#111111]/90" />
                      <div className="absolute bottom-0 right-0 h-8 w-16 bg-white/80" />
                      {cta.icon}
                    </div>
                    <div className="px-5 py-4 text-center">
                      <p className="break-keep text-[15px] font-black leading-snug text-foreground dark:text-white sm:text-base">{cta.title}</p>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="hidden gap-5 pt-5 sm:grid sm:grid-cols-3 lg:mt-auto">
                {featureHighlights.map((feature) => (
                  <div key={feature.title} className="group [perspective:1200px]">
                    <div
                      className={`flip-card relative min-h-[148px] overflow-hidden rounded-[10px] border-2 ${feature.card} transition-transform duration-500 group-hover:[transform:rotateY(180deg)]`}
                    >
                      <div className="flip-face absolute inset-0 z-0 flex flex-col p-4 text-center transition-opacity duration-300 group-hover:opacity-0">
                        <div
                          className={`relative mb-2 flex h-14 items-center justify-center overflow-hidden rounded-[8px] border-2 border-current bg-gradient-to-br ${feature.visual}`}
                        >
                          <div className="absolute right-0 top-0 h-4 w-12 bg-white/70" />
                          <div className="absolute bottom-0 left-0 h-3 w-16 bg-[#111111]/70" />
                          {feature.icon}
                        </div>
                        <p className="text-[15px] font-black text-foreground dark:text-[#f5f5f7]">
                          {feature.title}
                        </p>
                      </div>
                      <div className="absolute inset-0 z-10 flex items-center justify-center px-5 text-center opacity-0 transition-opacity duration-300 [transform:rotateY(180deg)] group-hover:opacity-100">
                        <p className="text-[13px] font-semibold text-foreground whitespace-pre-line dark:text-[#f5f5f7]">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <HomeArtistSpotlight frameHeight={212} />
            </div>

            <HomeSessionPanel />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4 sm:px-6">
        <div className="mb-12">
          <StripAdBanner />
        </div>

        <div
          data-scroll-reveal
          data-reveal-state="hidden"
          className={`flex flex-col gap-6 md:flex-row md:items-end md:justify-between ${scrollRevealBaseClass}`}
          style={{ transitionDelay: "0ms" }}
        >
          <div />
          <Link
            href="/forms"
            className="self-end text-sm font-semibold text-muted-foreground transition hover:text-foreground md:self-auto"
          >
            신청서(구양식) 다운로드 접수 안내 →
          </Link>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {serviceCards.map((card, index) => (
            <Link
              key={card.title}
              href={card.href}
              data-scroll-reveal
              data-reveal-state="hidden"
              style={{ transitionDelay: `${120 + index * 120}ms` }}
              className={`group relative min-h-[258px] overflow-hidden rounded-[10px] border-2 p-5 tracking-normal shadow-[8px_8px_0_#111111] transition duration-200 hover:-translate-y-1 hover:shadow-[12px_12px_0_#111111] focus-visible:ring-2 focus-visible:ring-[#111111]/60 dark:shadow-[8px_8px_0_#f2cf27] dark:hover:shadow-[12px_12px_0_#f2cf27] sm:min-h-[282px] sm:p-6 ${scrollRevealBaseClass} ${card.cardClass}`}
            >
              <div className="pointer-events-none absolute inset-0 opacity-95 transition-transform duration-300 group-hover:scale-[1.03]">
                <ServiceCardVisual tone={card.tone} />
              </div>
              <div className="relative z-10 flex min-h-[218px] flex-col sm:min-h-[234px]">
                <p className={`max-w-[11rem] text-[11px] font-black uppercase leading-4 tracking-normal ${card.labelClass}`}>
                  {card.label}
                </p>
                <h3 className="mt-7 max-w-[13rem] text-3xl font-black leading-none tracking-normal sm:text-4xl">
                  {card.title}
                </h3>
                <p className={`mt-4 max-w-[12rem] text-sm font-semibold leading-6 tracking-normal ${card.descriptionClass}`}>
                  {card.description}
                </p>
                <div className={`mt-auto inline-flex w-fit items-center gap-2 px-4 py-3 text-sm font-black tracking-normal transition group-hover:translate-x-1 ${card.actionClass}`}>
                  바로 시작 <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        <div className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white px-5 py-6 tracking-normal shadow-[8px_8px_0_#111111] dark:bg-[#111111] dark:text-white dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-7">
          <div aria-hidden="true" className="absolute right-0 top-0 hidden h-16 w-16 bg-[#f2cf27] sm:block" />
          <div aria-hidden="true" className="absolute right-12 top-12 hidden h-8 w-24 bg-[#1556a4] sm:block" />
          <div aria-hidden="true" className="absolute bottom-0 left-0 h-5 w-full bg-[#111111] dark:bg-[#f2cf27]" />
          <div
            data-scroll-reveal
            data-reveal-state="hidden"
            className={`relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between ${scrollRevealBaseClass}`}
            style={{ transitionDelay: "0ms" }}
          >
            <div className="max-w-2xl">
              <p className="w-fit border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-[11px] font-black uppercase tracking-normal text-[#111111] dark:border-white">
                접수 프로세스
              </p>
              <h2 className="mt-4 text-2xl font-black leading-tight text-[#111111] dark:text-white sm:text-3xl">
                심의는 4단계로 진행됩니다
              </h2>
              <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-[#111111]/68 dark:text-white/72">
                상품/방송국 패키지 선택부터 결제 확인까지 흐름을 간단하게 설계했습니다.
              </p>
            </div>
            <div className="hidden border-2 border-[#111111] bg-[#d9362c] px-4 py-3 text-sm font-black text-white shadow-[4px_4px_0_#111111] dark:border-white lg:block">
              4 STEP FLOW
            </div>
          </div>

          <div className="relative z-10 mt-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-3 right-3 top-1/2 hidden h-[3px] -translate-y-1/2 bg-[#111111] dark:bg-white md:block"
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {processSteps.map(({ label, tone, icon: Icon }, index) => (
                <div
                  key={label}
                  data-scroll-reveal
                  data-reveal-state="hidden"
                  style={{ transitionDelay: `${120 + index * 120}ms` }}
                  className={`relative min-h-[118px] overflow-hidden rounded-[8px] border-2 border-[#111111] p-4 shadow-[4px_4px_0_#111111] ${scrollRevealBaseClass} ${tone}`}
                >
                  <div className="relative min-h-[78px] pr-11">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-normal opacity-75">
                        STEP {String(index + 1).padStart(2, "0")}
                      </p>
                      <p className="mt-3 text-[15px] font-black leading-tight sm:text-base">
                        {label}
                      </p>
                    </div>
                    <div className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-current bg-white/18 sm:h-10 sm:w-10">
                      <Icon className="h-5 w-5" strokeWidth={2.4} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
