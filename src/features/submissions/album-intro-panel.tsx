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
            비회원도 접수할 수 있으며, 발급되는 코드로 언제든 결과를 확인할
            수 있습니다.
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
        <div className="mt-6 border-t border-[#edf1f7] pt-6 dark:border-white/10">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.85fr]">
            <div>
              <p className="text-sm font-semibold text-[#2f3a4d] dark:text-white">
                진행 순서
              </p>
              <ol className="mt-4 space-y-4">
                {processHighlights.map((item) => (
                  <li
                    key={item.step}
                    className="grid grid-cols-[34px_minmax(0,1fr)] gap-3"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#edf4f7] text-xs font-semibold text-[#2f6f9f] dark:bg-[#a9c8dc]/10 dark:text-[#a9c8dc]">
                      {item.step}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[#2f3a4d] dark:text-white">
                        {item.title}
                      </span>
                      <span className="mt-1 block break-keep text-sm leading-6 text-[#667085] dark:text-white/64">
                        {item.description}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-sm font-semibold text-[#2f3a4d] dark:text-white">
                  미리 준비할 것
                </p>
                <ul className="mt-4 grid gap-2 text-sm text-[#526071] dark:text-white/70 sm:grid-cols-2 lg:grid-cols-1">
                  {preparationChecklist.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f6f9f] dark:bg-[#a9c8dc]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-[#edf1f7] pt-5 dark:border-white/10">
                <p className="text-sm font-semibold text-[#2f3a4d] dark:text-white">
                  파일 업로드가 안 될 때
                </p>
                <p className="mt-2 break-keep text-sm leading-6 text-[#667085] dark:text-white/64">
                  신청서는 그대로 제출하고, 음원 파일만 이메일로 보내주세요.
                </p>
                <p className="mt-2 text-sm font-semibold text-[#2f6f9f] dark:text-[#a9c8dc]">
                  {supportEmail}
                </p>
              </div>

              <div className="border-t border-[#edf1f7] pt-5 dark:border-white/10">
                <p className="text-sm font-semibold text-[#2f3a4d] dark:text-white">
                  결과 확인
                </p>
                <ul className="mt-3 space-y-2 text-sm text-[#526071] dark:text-white/70">
                  {resultBenefits.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f6f9f] dark:bg-[#a9c8dc]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
