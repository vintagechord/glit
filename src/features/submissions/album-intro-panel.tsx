"use client";

import * as React from "react";

type ProcessHighlight = {
  step: string;
  title: string;
  description: string;
};

export function AlbumIntroPanel({
  processHighlights,
  preparationChecklist,
  resultBenefits,
  supportEmail,
}: {
  processHighlights: ProcessHighlight[];
  preparationChecklist: string[];
  resultBenefits: string[];
  supportEmail: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <section className="overflow-hidden rounded-[36px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,245,247,0.98))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(29,29,31,0.94),rgba(0,0,0,0.98))] dark:shadow-none sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
            Album Review
          </p>
          <h1 className="font-display mt-3 text-3xl leading-tight text-foreground sm:text-4xl">
            음반 심의 접수
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
            접수 방식만 고르면 바로 신청서 작성으로 이어집니다. 비회원도 접수할 수 있고,
            로그인 상태라면 진행 내역이 마이페이지에 저장됩니다.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
            <span className="rounded-full border border-black/8 bg-white/88 px-3 py-1.5 text-[#1d1d1f] dark:border-white/10 dark:bg-white/8 dark:text-white">
              비회원 접수 가능
            </span>
            <span className="rounded-full border border-[#0071e3] bg-[#0071e3] px-3 py-1.5 text-white dark:border-[#2997ff] dark:bg-[#2997ff] dark:text-[#00101f]">
              로그인 시 내역 저장
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_18px_40px_rgba(0,113,227,0.18)] transition hover:bg-[#0077ed] dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]"
          >
            {isOpen ? "닫기" : "알아보기"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {processHighlights.map((item) => (
              <div
                key={item.step}
                className="rounded-[24px] border border-black/6 bg-white/90 px-5 py-4 shadow-[0_16px_32px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-white/5 dark:shadow-none"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0071e3] dark:text-[#8bc3ff]">
                  Step {item.step}
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-black/6 bg-white/92 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                접수 전 준비
              </p>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {preparationChecklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#0071e3] dark:bg-[#8bc3ff]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-[#0071e3] bg-[#0071e3] p-6 text-white shadow-[0_18px_40px_rgba(0,113,227,0.16)] dark:border-[#2997ff] dark:bg-[#2997ff] dark:text-[#00101f] dark:shadow-none">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80 dark:text-[#00101f]/70">
                  파일 업로드 안내
                </p>
                <p className="mt-3 text-sm leading-6 text-white/92 dark:text-[#00101f]/82">
                  음원 파일 업로드가 완료되지 않으면 파일 첨부 없이 다음 단계로 진행해
                  신청서를 먼저 제출한 뒤, 음원 파일만 이메일로 보내주세요.
                </p>
                <p className="mt-4 text-sm font-semibold">{supportEmail}</p>
              </div>

              <div className="rounded-[28px] border border-black/6 bg-white/90 p-6 dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  결과 확인
                </p>
                <div className="mt-4 grid gap-3">
                  {resultBenefits.map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-black/6 bg-[#f5f5f7] px-4 py-4 text-sm text-[#1d1d1f] dark:border-white/10 dark:bg-black/30 dark:text-white"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
