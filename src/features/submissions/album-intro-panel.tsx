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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-display text-3xl font-black leading-tight text-foreground sm:text-4xl">
            음반 심의 접수
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
            발매 여부를 선택하면 필요한 항목만 안내해드려요.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-black text-foreground">
              비회원 가능
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls="album-preparation-checklist"
            className="bauhaus-button h-11 px-5 text-sm"
          >
            {isOpen ? "사전 준비 사항 닫기" : "사전 준비 사항"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div id="album-preparation-checklist" className="mt-6">
          <p className="mb-4 text-sm font-semibold text-muted-foreground">
            공통으로 접수자 이름, 이메일, 연락처가 필요해요.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[10px] border-2 border-border bg-background p-5">
              <h2 className="text-sm font-black text-foreground">발매 전 음반</h2>
              <p className="mt-2 text-sm text-muted-foreground">신청서와 음원 자료를 준비해주세요.</p>
              <ul className="mt-4 grid gap-2 text-sm font-semibold text-foreground">
                {preparationChecklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-2 w-2 shrink-0 bg-[#1556a4] dark:bg-[#f2cf27]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[10px] border-2 border-border bg-background p-5">
              <h2 className="text-sm font-black text-foreground">이미 발매된 음반</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                멜론 또는 지니의 앨범 링크를 준비해주세요. 신청서 작성과 음원 파일 첨부 없이 접수할 수 있어요.
              </p>
              <p className="mt-4 text-sm font-semibold leading-6 text-foreground">
                추가금 없이 이용하며, 접수한 링크로 관리자가 심의 자료를 준비합니다.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
