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
    <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
      <div aria-hidden="true" className="absolute right-0 top-0 h-16 w-16 bg-[#f2cf27]" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="bauhaus-kicker">
            Broadcast Review Submission
          </p>
          <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
            음반 심의 접수
          </h1>
          <p className="mt-4 max-w-2xl text-sm font-semibold text-muted-foreground sm:text-base">
            접수 방식만 고르면 바로 신청서 작성으로 이어집니다. 비회원도 접수할 수 있고,
            로그인 상태라면 진행 내역이 마이페이지에 저장됩니다.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="bauhaus-button h-11 px-5 text-sm"
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
                className="rounded-[8px] border-2 border-border bg-background px-5 py-4"
              >
                <p className="text-[11px] font-black uppercase tracking-normal text-[#1556a4] dark:text-[#f2cf27]">
                  Step {item.step}
                </p>
                <h2 className="mt-2 text-lg font-black tracking-normal text-foreground">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[10px] border-2 border-border bg-background p-6">
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                접수 전 준비
              </p>
              <ul className="mt-4 space-y-2 text-sm font-semibold text-foreground">
                {preparationChecklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1 h-2 w-2 bg-[#1556a4] dark:bg-[#f2cf27]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-6 text-white shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
                <p className="text-[11px] font-black uppercase tracking-normal text-white/80">
                  파일 업로드 안내
                </p>
                <p className="mt-3 text-sm font-semibold leading-6 text-white/92">
                  음원 파일 업로드가 완료되지 않으면 파일 첨부 없이 다음 단계로 진행해
                  신청서를 먼저 제출한 뒤, 음원 파일만 이메일로 보내주세요.
                </p>
                <p className="mt-4 text-sm font-semibold">{supportEmail}</p>
              </div>

              <div className="rounded-[10px] border-2 border-border bg-background p-6">
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  결과 확인
                </p>
                <div className="mt-4 grid gap-3">
                  {resultBenefits.map((item) => (
                    <div
                      key={item}
                      className="rounded-[8px] border-2 border-border bg-card px-4 py-4 text-sm font-semibold text-foreground"
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
