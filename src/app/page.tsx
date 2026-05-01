import Link from "next/link";
import {
  BellRing,
  CheckCircle2,
  Clapperboard,
  CreditCard,
  Disc3,
  FileText,
  MousePointerClick,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { StripAdBanner } from "@/components/site/strip-ad-banner";
import { ScrollRevealObserver } from "@/components/scroll-reveal-observer";
import { HomeArtistSpotlight } from "@/features/home/home-artist-spotlight";
import { HomeSessionPanel } from "@/features/home/home-session-panel";

const heroCtas = [
  {
    title: "음반 심의 신청",
    href: "/dashboard/new/album",
    visual: "bg-[#f2cf27] text-[#111111] dark:bg-[#f2cf27] dark:text-[#111111]",
    icon: Disc3,
  },
  {
    title: "뮤직비디오 심의 신청",
    href: "/dashboard/new/mv",
    visual: "bg-[#1556a4] text-white dark:bg-[#3f8ad8] dark:text-[#06111f]",
    icon: Clapperboard,
  },
];

const featureHighlights = [
  {
    title: "실시간 진행 알림",
    description:
      "방송국별 심의 진행 상황을 실시간으로 확인하세요.",
    card:
      "bg-[#fffaf0] text-[#111111] border-[#111111] shadow-[5px_5px_0_#111111] dark:bg-[#171717] dark:text-[#f5f5f7] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]",
    iconBox: "bg-[#1556a4] text-white dark:bg-[#3f8ad8] dark:text-[#06111f]",
    icon: BellRing,
  },
  {
    title: "파일 업로드",
    description:
      "온사이드는 자체 스토리지 운영으로 안전하게 음원과 영상을 관리합니다.",
    card:
      "bg-white text-[#111111] border-[#111111] shadow-[5px_5px_0_#111111] dark:bg-[#171717] dark:text-[#f5f5f7] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]",
    iconBox: "bg-[#1f7a5a] text-white dark:bg-[#46b783] dark:text-[#06111f]",
    icon: UploadCloud,
  },
  {
    title: "관리자 승인",
    description:
      "접수 시 1차 체크, 방송국 전달 전 2차 검수로 빈틈 없이 진행합니다.",
    card:
      "bg-[#f2cf27] text-[#111111] border-[#111111] shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]",
    iconBox: "bg-[#d9362c] text-white dark:bg-[#ff6258] dark:text-[#111111]",
    icon: ShieldCheck,
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

      <section className="w-full -mt-24 pb-8 pt-28 sm:-mt-28 sm:pb-10 sm:pt-36">
        <div className="relative w-full overflow-hidden border-y-2 border-[#111111] bg-[#fffaf0] shadow-[0_24px_80px_rgba(31,41,55,0.12)] dark:border-[#f2cf27] dark:bg-[#101010]">
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#fffaf0_0%,#fffaf0_64%,rgba(242,207,39,0.18)_100%)] dark:bg-[linear-gradient(135deg,#101010_0%,#101010_64%,rgba(242,207,39,0.12)_100%)]" />
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
                {heroCtas.map((cta) => {
                  const Icon = cta.icon;
                  return (
                    <Link
                      key={cta.title}
                      href={cta.href}
                      className="group overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 hover:shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27] dark:hover:shadow-[8px_8px_0_#f2cf27]"
                    >
                      <div
                        className={`flex h-28 items-center justify-center sm:h-32 ${cta.visual}`}
                      >
                        <Icon className="h-14 w-14 sm:h-16 sm:w-16" strokeWidth={2.2} />
                      </div>
                      <div className="px-5 py-4 text-center">
                        <p className="break-keep text-[15px] font-black leading-snug text-foreground dark:text-white sm:text-base">{cta.title}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="hidden gap-5 pt-5 sm:grid sm:grid-cols-3 lg:mt-auto">
                {featureHighlights.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div key={feature.title} className="group [perspective:1200px]">
                      <div
                        className={`flip-card relative min-h-[148px] overflow-hidden rounded-[10px] border-2 ${feature.card} transition-transform duration-500 group-hover:[transform:rotateY(180deg)]`}
                      >
                        <div className="flip-face absolute inset-0 z-0 flex flex-col items-center justify-center gap-3 p-4 text-center transition-opacity duration-300 group-hover:opacity-0">
                          <div
                            className={`flex h-14 w-14 items-center justify-center rounded-[8px] border-2 border-current ${feature.iconBox}`}
                          >
                            <Icon className="h-8 w-8" strokeWidth={2.35} />
                          </div>
                          <p className="text-[15px] font-black text-current">
                            {feature.title}
                          </p>
                        </div>
                        <div className="absolute inset-0 z-10 flex items-center justify-center px-5 text-center opacity-0 transition-opacity duration-300 [transform:rotateY(180deg)] group-hover:opacity-100">
                          <p className="whitespace-pre-line text-[13px] font-semibold text-current">
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                  바로 시작 <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        <div className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white px-5 py-6 tracking-normal shadow-[8px_8px_0_#111111] dark:bg-[#111111] dark:text-white dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-7">
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
