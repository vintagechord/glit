"use client";

import * as React from "react";

type ProcessHighlight = {
  step: string;
  title: string;
  description: string;
};

const oneClickComparison = [
  ["추천 대상", "직접 입력이 익숙한 기획사", "빠르게 맡기고 싶은 아티스트"],
  ["사용자 입력", "앨범·트랙·가사 직접 입력", "멜론 링크와 파일 중심"],
  ["온사이드 처리", "제출값 검수", "앨범 정보 정리 대행"],
  ["필요 파일", "WAV, 가사, 앨범 정보", "멜론 링크, WAV 음원"],
  ["결과 차이", "동일", "동일"],
];

export function AlbumIntroPanel({
  processHighlights,
  preparationChecklist,
  resultBenefits,
}: {
  processHighlights: ProcessHighlight[];
  preparationChecklist: string[];
  resultBenefits: string[];
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="bauhaus-kicker">음반 심의 신청</p>
          <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
            음반 심의 접수
          </h1>
          <p className="mt-4 max-w-2xl text-sm font-semibold text-muted-foreground sm:text-base">
            접수 방식을 선택하면 바로 신청서를 작성할 수 있습니다.
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
                  음원 파일 업로드가 완료되지 않으면 파일 첨부 없이 다음 단계로 진행하거나
                  예전 온사이드 사이트에서 동일하게 접수할 수 있습니다.
                </p>
                <p className="mt-4 text-sm font-semibold">onside17.com</p>
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

          <div className="rounded-[10px] border-2 border-border bg-background p-6">
            <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
              일반 접수와 원클릭 접수 비교
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-border text-xs font-black text-muted-foreground">
                    <th className="py-2 pr-4">구분</th>
                    <th className="py-2 pr-4">일반 접수</th>
                    <th className="py-2">원클릭 접수</th>
                  </tr>
                </thead>
                <tbody className="font-semibold text-foreground">
                  {oneClickComparison.map(([label, standard, oneClick]) => (
                    <tr key={label} className="border-b border-border/60">
                      <td className="py-3 pr-4 text-muted-foreground">{label}</td>
                      <td className="py-3 pr-4">{standard}</td>
                      <td className="py-3">{oneClick}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
