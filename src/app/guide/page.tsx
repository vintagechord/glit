import Link from "next/link";

import { albumPreparationItems, faqItems, mvPreparationItems } from "@/lib/onside-content";

export const metadata = {
  title: "심의 안내",
};

const albumSteps = [
  {
    number: "01",
    title: "음반심의란?",
    description:
      "TV·라디오 송출 전 방송국이 음원, 가사, 앨범 정보를 확인하는 절차입니다.",
  },
  {
    number: "02",
    title: "방송국 심의 현황",
    description:
      "MBC, SBS, KBS 등 주요 방송국과 지역 방송국별로 접수·결과 일정이 다릅니다.",
    bullets: [
      "결과 기간: 접수 후 1일~최대 3주",
      "발매 전·후 모두 접수 가능",
      "일부 방송국은 직접 제출 기준",
    ],
  },
  {
    number: "03",
    title: "온사이드의 심의 대행",
    description: "접수, 자료 확인, 결제, 결과 안내를 한 흐름으로 관리합니다.",
    bullets: [
      "온라인 접수·카드 결제 지원",
      "디지털 음반은 심의용 CD·가사집 제작 지원",
      "진행 현황과 결과를 개별 페이지에서 확인",
    ],
  },
];

const mvSteps = [
  {
    number: "01",
    title: "뮤직비디오 심의란?",
    description:
      "유통, 온라인 업로드, TV 송출 목적에 맞춰 영상 등급과 제출 조건을 확인합니다.",
  },
  {
    number: "02",
    title: "방송국 및 영등위 심의 현황",
    description:
      "온라인용은 유통 제출 중심, TV 송출용은 방송국별 개별 조건 확인이 필요합니다.",
  },
  {
    number: "03",
    title: "온사이드의 뮤비 심의 대행",
    description: "신청서 작성, 파일 제출, 결과 안내를 목적별로 정리해 진행합니다.",
    bullets: [
      "온라인 신청서와 파일 업로드 지원",
      "방송국 접수 전 자료 확인",
      "결과 파일과 진행 현황 제공",
    ],
  },
];

export default function GuidePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">이용가이드</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">심의 안내</h1>
      <p className="mt-3 text-sm font-semibold text-muted-foreground">
        음반과 뮤직비디오 심의 흐름, 준비물, 자주 묻는 질문을 정리했습니다.
      </p>

      <section className="relative mt-10 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <div aria-hidden="true" className="absolute right-0 top-0 h-16 w-16 bg-[#f2cf27]" />
        <h2 className="font-display mt-4 text-2xl font-black text-foreground">
          음반심의, 이렇게 진행됩니다
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {albumSteps.map((step) => (
            <div
              key={step.number}
              className="rounded-[8px] border-2 border-border bg-background/80 p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] text-xs font-black uppercase tracking-normal text-[#111111]">
                  {step.number}
                </span>
                <div>
                  <p className="text-sm font-black text-foreground">
                    {step.title}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm font-semibold text-muted-foreground">
                {step.description}
              </p>
              {step.bullets && (
                <ul className="mt-3 space-y-1 text-xs font-semibold text-muted-foreground">
                  {step.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-1 h-2 w-2 bg-[#1556a4]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Link
            href="/dashboard/new/album"
            className="bauhaus-button px-6 py-3 text-xs uppercase"
          >
            음반심의 신청하러 가기
          </Link>
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <div aria-hidden="true" className="absolute right-0 top-0 h-16 w-16 bg-[#1556a4]" />
        <h2 className="font-display mt-4 text-2xl font-black text-foreground">
          뮤직비디오 심의, 이렇게 진행됩니다
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {mvSteps.map((step) => (
            <div
              key={step.number}
              className="rounded-[8px] border-2 border-border bg-background/80 p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#1556a4] text-xs font-black uppercase tracking-normal text-white">
                  {step.number}
                </span>
                <div>
                  <p className="text-sm font-black text-foreground">
                    {step.title}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm font-semibold text-muted-foreground">
                {step.description}
              </p>
              {step.bullets && (
                <ul className="mt-3 space-y-1 text-xs font-semibold text-muted-foreground">
                  {step.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-1 h-2 w-2 bg-[#d9362c]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Link
            href="/dashboard/new/mv"
            className="bauhaus-button px-6 py-3 text-xs uppercase"
          >
            뮤직비디오 심의 신청하러 가기
          </Link>
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <h2 className="font-display text-2xl font-black text-foreground">
          신청 전 준비물 체크리스트
        </h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[8px] border-2 border-border bg-background p-5">
            <p className="text-sm font-black text-foreground">음반 심의 준비물</p>
            <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground">
              {albumPreparationItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-2 w-2 bg-[#f2cf27]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[8px] border-2 border-border bg-background p-5">
            <p className="text-sm font-black text-foreground">
              뮤직비디오 심의 준비물
            </p>
            <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground">
              {mvPreparationItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-2 w-2 bg-[#1556a4]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-12 rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <h2 className="font-display text-2xl font-black text-foreground">
          자주 묻는 질문
        </h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {faqItems.slice(0, 6).map((item) => (
            <Link
              key={item.question}
              href="/faq"
              className="rounded-[8px] border-2 border-border bg-background p-4 transition hover:border-[#1556a4]"
            >
              <p className="text-[11px] font-black text-muted-foreground">
                {item.category}
              </p>
              <p className="mt-2 text-sm font-black text-foreground">
                {item.question}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
