"use client";

import * as React from "react";

export function AlbumIntroPanel({
  preparationChecklist,
}: {
  preparationChecklist: string[];
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
            {isOpen ? "닫기" : "준비물 보기"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="mt-6">
          <div className="rounded-[10px] border-2 border-border bg-background p-6">
            <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
              접수 전 준비
            </p>
            <ul className="mt-4 grid gap-2 text-sm font-semibold text-foreground md:grid-cols-2">
              {preparationChecklist.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1 h-2 w-2 bg-[#1556a4] dark:bg-[#f2cf27]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
