import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Disc3,
  FileCheck2,
  HelpCircle,
  ShoppingCart,
} from "lucide-react";

import { albumPreparationItems, mvPreparationItems } from "@/lib/onside-content";

export const metadata = {
  title: "심의 안내",
};

const reviewFlowSteps = [
  {
    number: "1",
    title: "준비",
    description: "파일 · 기본 정보",
    icon: FileCheck2,
  },
  {
    number: "2",
    title: "신청·결제",
    description: "장바구니에서 한 번에",
    icon: ShoppingCart,
  },
  {
    number: "3",
    title: "결과",
    description: "마이페이지 · 조회 코드",
    icon: CheckCircle2,
  },
];

const reviewTypeCards = [
  {
    badge: "음반",
    title: "음반 심의",
    description: "TV · RADIO",
    icon: Disc3,
    accentClass: "bg-[#f2cf27] text-[#111111]",
    bulletClass: "bg-[#1556a4]",
    href: "/dashboard/new/album",
    cta: "음반 신청",
    bullets: [
      "주요·지역 방송국별 일정 상이",
      "발매 전·후 접수 가능",
      "디지털 음반은 심의용 CD·가사집 제작 지원",
    ],
  },
  {
    badge: "MV",
    title: "뮤직비디오 심의",
    description: "온라인 · TV",
    icon: Clapperboard,
    accentClass: "bg-[#1556a4] text-white",
    bulletClass: "bg-[#d9362c]",
    href: "/dashboard/new/mv",
    cta: "MV 신청",
    bullets: [
      "온라인용은 유통 제출 중심",
      "TV 송출용은 방송국별 조건 확인",
      "결과 파일과 진행 현황 제공",
    ],
  },
];

export default function GuidePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">이용가이드</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">심의 안내</h1>

      <section className="relative mt-8 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
        <div aria-hidden="true" className="absolute right-0 top-0 h-16 w-16 bg-[#f2cf27]" />
        <h2 className="font-display mt-4 text-2xl font-black text-foreground">
          3단계로 간단하게
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {reviewFlowSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.number}
                className="relative flex items-center gap-4 rounded-[8px] border-2 border-border bg-background/80 p-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="absolute right-3 top-2 text-[10px] font-black text-muted-foreground">
                  {step.number}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-foreground">{step.title}</p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                {index < reviewFlowSteps.length - 1 ? (
                  <ArrowRight className="ml-auto hidden h-4 w-4 text-muted-foreground lg:block" aria-hidden="true" />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="relative mt-10 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
        <div aria-hidden="true" className="absolute right-0 top-0 h-16 w-16 bg-[#1556a4]" />
        <h2 className="font-display mt-4 text-2xl font-black text-foreground">
          심의 선택
        </h2>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {reviewTypeCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-[8px] border-2 border-border bg-background/80 p-5"
              >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-[8px] border-2 border-[#111111] ${card.accentClass}`}
                >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                  <span className="sr-only">{card.badge}</span>
                </span>
                <div>
                  <p className="text-base font-black text-foreground">{card.title}</p>
                  <p className="mt-1 text-[11px] font-black text-muted-foreground">
                    {card.description}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={card.href}
                  className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-2 text-xs font-black text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#06111f] dark:shadow-[3px_3px_0_#f2cf27]"
                >
                  {card.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <details className="group text-xs font-semibold text-muted-foreground">
                  <summary className="cursor-pointer rounded-[6px] px-2 py-2 font-black text-foreground marker:text-[#1556a4]">
                    핵심 조건
                  </summary>
                  <ul className="mt-2 space-y-2 rounded-[8px] border border-border bg-card p-3">
                    {card.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2">
                        <span className={`mt-1 h-2 w-2 shrink-0 ${card.bulletClass}`} />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="relative mt-10 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
        <h2 className="font-display text-2xl font-black text-foreground">
          사전 준비 사항
        </h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <details className="group rounded-[8px] border-2 border-border bg-background p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <Disc3 className="h-5 w-5" aria-hidden="true" />
                음반
              </span>
              <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground group-open:bg-[#f2cf27] group-open:text-[#111111]">
                {albumPreparationItems.length}
              </span>
            </summary>
            <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground">
              {albumPreparationItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-2 w-2 bg-[#f2cf27]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </details>
          <details className="group rounded-[8px] border-2 border-border bg-background p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <Clapperboard className="h-5 w-5" aria-hidden="true" />
                뮤직비디오
              </span>
              <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground group-open:bg-[#f2cf27] group-open:text-[#111111]">
                {mvPreparationItems.length}
              </span>
            </summary>
            <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground">
              {mvPreparationItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-2 w-2 bg-[#1556a4]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-4 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[8px_8px_0_#111111] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-3">
          <HelpCircle className="h-8 w-8" aria-hidden="true" />
          <h2 className="font-display text-xl font-black">더 궁금한 점</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/faq"
            className="inline-flex items-center rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-xs font-black shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5"
          >
            FAQ
          </Link>
          <Link
            href="/support"
            className="inline-flex items-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-2 text-xs font-black text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5"
          >
            1:1 문의
          </Link>
        </div>
      </section>
    </div>
  );
}
