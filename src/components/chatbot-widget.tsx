"use client";

import * as React from "react";

const faqItems = [
  {
    question: "심의는 얼마나 걸리나요?",
    answer:
      "방송국별로 상이하지만 평균 7일 내외입니다. 일정에 따라 최대 2~3주까지 소요될 수 있습니다.",
  },
  {
    question: "비회원 접수도 가능한가요?",
    answer:
      "가능합니다. 비회원 접수 시 발급되는 조회 코드로 진행 상황을 확인할 수 있습니다.",
  },
  {
    question: "결제 방법은 무엇인가요?",
    answer:
      "카드 결제 또는 무통장 입금을 선택할 수 있습니다. 카드 결제는 추후 모듈 연동 예정입니다.",
  },
  {
    question: "파일 형식 제한이 있나요?",
    answer:
      "음원은 WAV/ZIP, 영상은 MP4/MOV 형식을 권장합니다. 용량 제한은 안내된 기준을 확인해주세요.",
  },
];

export function ChatbotWidget() {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="mb-3 w-[320px] rounded-3xl border border-border/60 bg-card/95 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.2)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Onside 도움말
              </p>
              <p className="text-sm font-semibold text-foreground">
                무엇을 도와드릴까요?
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              닫기
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {faqItems.map((item, index) => (
              <button
                key={item.question}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`w-full rounded-2xl border px-3 py-2 text-left text-xs transition ${
                  activeIndex === index
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-muted-foreground hover:border-foreground"
                }`}
              >
                {item.question}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 px-3 py-3 text-xs text-muted-foreground">
            {faqItems[activeIndex]?.answer}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background shadow-lg transition hover:-translate-y-0.5"
      >
        Q&A
      </button>
    </div>
  );
}
