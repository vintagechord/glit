import Link from "next/link";
import {
  CheckCircle2,
  Clapperboard,
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
    visual: "from-[#dff1ff] via-[#fef5e7] to-[#eef6ff]",
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
    visual: "from-[#e6f0ff] via-[#f6f3ff] to-[#e7f7ff]",
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
      "bg-[#f7f8fb] text-[#1d1d1f] border-white/80 shadow-[0_16px_40px_rgba(15,23,42,0.08)] dark:bg-[#1d1d1f] dark:text-[#f5f5f7] dark:border-white/10 dark:shadow-none",
    visual: "from-[#d7ecff] via-white to-[#eef6ff]",
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
      "bg-white text-[#1d1d1f] border-[#eef2f7] shadow-[0_16px_40px_rgba(15,23,42,0.08)] dark:bg-[#1d1d1f] dark:text-[#f5f5f7] dark:border-white/10 dark:shadow-none",
    visual: "from-[#e7fff2] via-white to-[#eaf7ff]",
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
      "bg-[#eef2ff] text-[#1d1d1f] border-[#dbe5ff] shadow-[0_16px_40px_rgba(15,23,42,0.08)] dark:bg-[#1d1d1f] dark:text-[#f5f5f7] dark:border-white/10 dark:shadow-none",
    visual: "from-[#fff4d6] via-white to-[#ffe9d6]",
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

const processStepTones = [
  "border-[#d9e6f7] bg-[linear-gradient(180deg,#ffffff,#f4f9ff)] text-[#16324d] shadow-[0_12px_28px_rgba(148,163,184,0.12)] dark:border-[#1f3244] dark:bg-[linear-gradient(180deg,#15202c,#0f1823)] dark:text-[#d6e9ff]",
  "border-[#cfe2fb] bg-[linear-gradient(180deg,#f7fbff,#edf5ff)] text-[#123152] shadow-[0_12px_28px_rgba(125,176,255,0.16)] dark:border-[#244466] dark:bg-[linear-gradient(180deg,#11263c,#0d1d2f)] dark:text-[#d4e6ff]",
  "border-[#c9dcff] bg-[linear-gradient(180deg,#eef6ff,#e3efff)] text-[#0f3760] shadow-[0_12px_28px_rgba(96,165,250,0.18)] dark:border-[#29527a] dark:bg-[linear-gradient(180deg,#102a43,#0d2135)] dark:text-[#cfe4ff]",
  "border-[#bfd7ff] bg-[linear-gradient(180deg,#e7f2ff,#dcecff)] text-[#0b4270] shadow-[0_14px_32px_rgba(0,113,227,0.18)] dark:border-[#316191] dark:bg-[linear-gradient(180deg,#113152,#0d2741)] dark:text-[#c9e1ff]",
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
      <div className="pointer-events-none absolute left-[-20%] top-[-10%] h-[420px] w-[420px] rounded-full bg-[#a8cdf8]/26 blur-[180px] dark:bg-[#0b2a46]/60" />
      <div className="pointer-events-none absolute right-[-15%] top-[10%] h-[380px] w-[380px] rounded-full bg-white/60 blur-[180px] dark:bg-[#2997ff]/18" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[20%] h-[320px] w-[320px] rounded-full bg-[#dbe9fb]/45 blur-[180px] dark:bg-white/6" />

      <section className="w-full -mt-24 pb-8 pt-28 sm:-mt-28 sm:pb-10 sm:pt-36">
        <div className="relative w-full overflow-hidden border-b border-border/60 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.98),_rgba(245,245,247,0.96),_rgba(232,239,247,0.9))] shadow-[0_24px_80px_rgba(31,41,55,0.12)] dark:bg-[radial-gradient(circle_at_top,_rgba(29,29,31,0.98),_rgba(0,0,0,0.99),_rgba(0,0,0,1))]">
          <div className="absolute inset-0">
            <OscilloscopeCurtainBackground />
            <div className="absolute inset-0 bg-gradient-to-r from-white/70 via-white/35 to-transparent dark:from-background/72 dark:via-background/30" />
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 duration-700 sm:gap-6 lg:min-h-[520px] lg:h-full">
              <span className="inline-flex w-fit items-center rounded-full border border-black/8 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-foreground/72 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-white/10 dark:bg-white/6 dark:text-white/84 dark:shadow-none">
                OFFICIAL MUSIC & VIDEO CLEARANCE
              </span>
              <h1 className="font-display text-2xl leading-tight text-foreground sm:text-4xl">
                음반 · M/V 심의를 쉽고 빠르게!
              </h1>
              <div className="max-w-xl rounded-[24px] border border-black/6 bg-white/58 px-5 py-4 shadow-[0_14px_36px_rgba(15,23,42,0.06)] backdrop-blur-md dark:border-white/10 dark:bg-white/6 dark:shadow-none">
                <p className="text-[13px] leading-6 text-foreground/78 sm:text-[15px] dark:text-white/80">
                  온사이드에서 방송사별 심의 진행을 실시간으로 받아보세요.
                </p>
                <p className="mt-2 text-[13px] leading-6 text-foreground/68 sm:text-[15px] dark:text-white/72">
                  나의 모든 심의 기록, 온사이드에서 모아 관리할 수 있습니다.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {heroCtas.map((cta) => (
                  <Link
                    key={cta.title}
                    href={cta.href}
                    className="group overflow-hidden rounded-[24px] border border-black/8 bg-white/62 backdrop-blur-md shadow-[0_14px_40px_rgba(0,0,0,0.1)] transition hover:-translate-y-1 hover:shadow-[0_22px_60px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-white/6 dark:shadow-none dark:hover:bg-white/10 sm:rounded-[28px]"
                  >
                    <div
                      className={`relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br sm:h-32 ${cta.visual}`}
                    >
                      <div className="absolute -left-6 top-[-22px] h-20 w-20 rounded-full bg-white/50 blur-xl" />
                      <div className="absolute -right-6 bottom-[-28px] h-24 w-24 rounded-full bg-white/55 blur-xl" />
                      {cta.icon}
                    </div>
                    <div className="px-5 py-4 text-center">
                      <p className="text-base font-semibold text-foreground dark:text-white">{cta.title}</p>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="hidden gap-5 pt-5 sm:grid sm:grid-cols-3 lg:mt-auto">
                {featureHighlights.map((feature) => (
                  <div key={feature.title} className="group [perspective:1200px]">
                    <div
                      className={`flip-card relative min-h-[148px] overflow-hidden rounded-[28px] border ${feature.card} transition-transform duration-500 group-hover:[transform:rotateY(180deg)]`}
                    >
                      <div className="flip-face absolute inset-0 z-0 flex flex-col p-4 text-center transition-opacity duration-300 group-hover:opacity-0">
                        <div
                          className={`relative mb-2 flex h-14 items-center justify-center overflow-hidden rounded-[18px] bg-gradient-to-br ${feature.visual}`}
                        >
                          <div className="absolute -right-7 -top-6 h-12 w-12 rounded-full bg-white/70 blur-lg" />
                          <div className="absolute -left-6 bottom-[-14px] h-10 w-10 rounded-full bg-white/60 blur-md" />
                          {feature.icon}
                        </div>
                        <p className="text-[15px] font-semibold text-foreground dark:text-[#f5f5f7]">
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
        <div className="rounded-[28px] border border-border/60 bg-background/80 px-5 py-6 sm:rounded-[32px] sm:px-8 sm:py-7">
          <div
            data-scroll-reveal
            data-reveal-state="hidden"
            className={`flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between ${scrollRevealBaseClass}`}
            style={{ transitionDelay: "0ms" }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                접수 프로세스
              </p>
              <h2 className="font-display mt-3 text-2xl text-foreground sm:text-3xl">
                심의는 4단계로 진행됩니다
              </h2>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                상품/방송국 패키지 선택부터 결제 확인까지 흐름을 간단하게 설계했습니다.
              </p>
            </div>
          </div>

          <div className="relative mt-4">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 top-1/2 hidden h-[2px] -translate-y-1/2 bg-[linear-gradient(90deg,rgba(203,213,225,0.35),rgba(125,176,255,0.55),rgba(0,113,227,0.75))] md:block"
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {["패키지 선택", "신청서 작성", "결제하기", "접수 완료"].map((label, index) => (
              <div
                key={label}
                data-scroll-reveal
                data-reveal-state="hidden"
                style={{ transitionDelay: `${120 + index * 120}ms` }}
                className={`relative overflow-hidden rounded-2xl border p-3.5 backdrop-blur-sm ${scrollRevealBaseClass} ${processStepTones[index] ?? "border-border/60 bg-card/70 text-foreground"
                  }`}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgba(255,255,255,0.35),rgba(0,113,227,0.85))]"
                />
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">
                  STEP {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-1.5 text-sm font-semibold">{label}</p>
              </div>
            ))}
          </div>
          </div>
        </div>
      </section>
    </div>
  );
}
