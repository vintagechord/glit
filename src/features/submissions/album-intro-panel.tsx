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
    <section className="relative overflow-hidden rounded-[8px] border border-[#d8e1ef] bg-white p-6 dark:border-white/10 dark:bg-[#111827] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-[#2f6f9f] dark:text-[#a9c8dc]">
            Broadcast Review Submission
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight text-[#2f3a4d] dark:text-white sm:text-4xl">
            음반 심의 접수
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-[#667085] dark:text-white/64 sm:text-base">
            접수 방식을 선택하면 바로 신청서를 작성할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="h-11 rounded-[8px] border border-[#c9d6e8] bg-white px-5 text-sm font-semibold text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f] dark:border-white/16 dark:bg-[#0f172a] dark:text-white"
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
                className="rounded-[8px] border border-[#d8e1ef] bg-[#fbfcfe] px-5 py-4 dark:border-white/10 dark:bg-white/5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-normal text-[#2f6f9f] dark:text-[#a9c8dc]">
                  Step {item.step}
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-normal text-[#2f3a4d] dark:text-white">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#667085] dark:text-white/64">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[8px] border border-[#d8e1ef] bg-[#fbfcfe] p-6 dark:border-white/10 dark:bg-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-normal text-[#667085] dark:text-white/64">
                접수 전 준비
              </p>
              <ul className="mt-4 space-y-2 text-sm font-medium text-[#2f3a4d] dark:text-white">
                {preparationChecklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[#2f6f9f] dark:bg-[#a9c8dc]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="rounded-[8px] border border-[#cbdde8] bg-[#edf4f7] p-6 text-[#2f3a4d] dark:border-[#a9c8dc]/30 dark:bg-[#a9c8dc]/10 dark:text-white">
                <p className="text-[11px] font-semibold uppercase tracking-normal text-[#2f6f9f] dark:text-[#a9c8dc]">
                  파일 업로드 안내
                </p>
                <p className="mt-3 text-sm leading-6 text-[#526071] dark:text-white/68">
                  음원 파일 업로드가 완료되지 않으면 파일 첨부 없이 다음 단계로 진행해
                  신청서를 먼저 제출한 뒤, 음원 파일만 이메일로 보내주세요.
                </p>
                <p className="mt-4 text-sm font-semibold text-[#2f6f9f] dark:text-[#a9c8dc]">{supportEmail}</p>
              </div>

              <div className="rounded-[8px] border border-[#d8e1ef] bg-[#fbfcfe] p-6 dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] font-semibold uppercase tracking-normal text-[#667085] dark:text-white/64">
                  결과 확인
                </p>
                <div className="mt-4 grid gap-3">
                  {resultBenefits.map((item) => (
                    <div
                      key={item}
                      className="rounded-[8px] border border-[#d8e1ef] bg-white px-4 py-4 text-sm font-medium text-[#2f3a4d] dark:border-white/10 dark:bg-[#0f172a] dark:text-white"
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
