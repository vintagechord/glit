"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";

const faqItems = [
  {
    question: "[주문결제] 결제는 어떻게 하나요?",
    answer: "본 홈페이지에서 카드 결제 또는 무통장 입금으로 가능합니다.",
  },
  {
    question: "[심의신청] 이미 발매된 앨범 심의 가능한가요?",
    answer: "네. 오래전에 발매된 앨범도 모두 음반심의가 가능합니다.",
  },
  {
    question: "[심의신청] 발매 예정인 앨범인데, 심의 가능한가요?",
    answer:
      "네. 다만 유통사를 통한 발매 날짜가 정해진 후 심의신청이 가능합니다. 발매일이 없는 경우 임의 날짜로 진행할 수 있으나 일부 방송사는 심의가 지연될 수 있습니다.",
  },
  {
    question: "[심의신청] 심의 신청은 언제 이루어지나요?",
    answer:
      "보통 심의자료 전달 후 3일 내 서울권, 1주일 내 경기권 접수가 이뤄집니다(주말/공휴일 제외). 긴급 심의는 1일 내 가능하며 추가금이 발생합니다.",
  },
  {
    question: "[심의신청] CD로 발매된 앨범의 경우 꼭 CD를 보내야 하나요?",
    answer:
      "네. 정식 CD 발매 앨범은 실제 CD 제출이 필요합니다. 보유 CD가 없으면 임의 제작이 가능하나 일부 방송사에서 인정되지 않을 수 있으며 실비 비용이 발생할 수 있습니다.",
  },
  {
    question: "[심의신청] 국악방송, 국방방송 신청도 가능한가요?",
    answer:
      `네. 기본 옵션에 포함되지 않아 추가금이 발생합니다. 해당 방송국에 적합한 앨범일 경우 진행 가능하며, 문의는 ${APP_CONFIG.supportPhone} 또는 ${APP_CONFIG.supportEmail} 입니다.`,
  },
  {
    question: "[심의결과] 심의 결과는 어떻게 확인하나요?",
    answer: "개별 심의확인 페이지에서 실시간 진행 상황을 확인할 수 있습니다.",
  },
  {
    question: "[심의결과] 심의 결과가 늦어지는 이유는 무엇인가요?",
    answer:
      "방송사 내부 일정과 업무량에 따라 지연될 수 있습니다. 온사이드는 주기적으로 확인하며 개별 페이지로 결과를 실시간 업데이트합니다.",
  },
  {
    question: "[주문결제] 2장 이상의 앨범은 할인 혜택이 있나요?",
    answer:
      "네. 첫 번째 앨범은 기본가격, 두 번째부터는 50% 할인됩니다. 예) 3장(10개 패키지): 10만원 + 5만원 + 5만원.",
  },
  {
    question: "[onside] 온사이드는 정식 업체인가요?",
    answer:
      "네. 영포에버가 운영하는 정식 등록 업체이며 세금계산서/현금영수증 발급이 가능합니다.",
  },
  {
    question: "비회원 접수도 가능한가요?",
    answer:
      "가능합니다. 비회원 접수 시 발급되는 조회 코드로 진행 상황을 확인할 수 있습니다.",
  },
  {
    question: "파일 형식 제한이 있나요?",
    answer:
      "음원은 WAV/ZIP, 영상은 MP4/MOV 형식을 권장합니다. 용량 제한은 안내된 기준을 확인해주세요.",
  },
  {
    question: "추가 문의",
    answer:
      `${APP_CONFIG.supportEmail} 또는 ${APP_CONFIG.supportPhone} 으로 문의주시면 자세한 상담이 가능합니다.`,
  },
];

export function ChatbotWidget() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [pageIndex, setPageIndex] = React.useState(0);
  const pageSize = 5;
  const pageCount = Math.ceil(faqItems.length / pageSize);
  const startIndex = pageIndex * pageSize;
  const visibleItems = faqItems.slice(startIndex, startIndex + pageSize);

  const goToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(nextPage, 0), pageCount - 1);
    setPageIndex(clamped);
    setActiveIndex(null);
  };

  React.useEffect(() => {
    if (open) {
      setActiveIndex(null);
    }
  }, [open]);

  React.useEffect(() => {
    setOpen(false);
    setActiveIndex(null);
  }, [pathname]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-x-0 bottom-0 z-40"
          style={{ top: "var(--site-header-height, 76px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="자주 묻는 질문"
            className="absolute bottom-6 right-6 w-[320px] rounded-[10px] border-2 border-[#111111] bg-card p-4 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-foreground">
                  자주 묻는 질문
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] border-2 border-border px-2 py-1 text-xs font-black text-muted-foreground transition hover:text-foreground"
              >
                닫기
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {visibleItems.map((item, index) => {
                const itemIndex = startIndex + index;
                return (
                  <button
                    key={item.question}
                    type="button"
                    onClick={() => setActiveIndex(itemIndex)}
                    className={`w-full rounded-[8px] border-2 px-3 py-2 text-left text-xs font-semibold transition ${activeIndex === itemIndex
                        ? "border-foreground bg-foreground text-background"
                        : "border-border/60 bg-background text-muted-foreground hover:border-foreground"
                      }`}
                  >
                    {item.question}
                  </button>
                );
              })}
              <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => goToPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                  className="rounded-[8px] border-2 border-border px-3 py-1 font-black uppercase tracking-normal transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  이전
                </button>
                <span>
                  {pageIndex + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(pageIndex + 1)}
                  disabled={pageIndex >= pageCount - 1}
                  className="rounded-[8px] border-2 border-border px-3 py-1 font-black uppercase tracking-normal transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  다음
                </button>
              </div>
            </div>
            {activeIndex === null ? (
              <div className="mt-4 rounded-[8px] border-2 border-border bg-background/80 px-3 py-3 text-sm font-semibold leading-relaxed text-muted-foreground">
                질문을 선택해주세요.
              </div>
            ) : (
              <div className="mt-4 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-3 text-sm font-semibold leading-relaxed text-black shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-black dark:shadow-none">
                {faqItems[activeIndex]?.answer}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-12 w-12 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] text-sm font-black text-[#111111] shadow-[4px_4px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27]"
        >
          FAQ
        </button>
      </div>
    </>
  );
}
