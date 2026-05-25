import Link from "next/link";

import { faqItems } from "@/lib/onside-content";

export const metadata = {
  title: "FAQ",
};

const categories = Array.from(new Set(faqItems.map((item) => item.category)));

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">FAQ</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        자주 묻는 질문
      </h1>
      <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">
        준비물, 결제, 진행 확인, 결과 수령에서 자주 묻는 내용을 정리했습니다.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {categories.map((category) => (
          <span
            key={category}
            className="rounded-[6px] border-2 border-border bg-card px-3 py-1 text-xs font-black text-foreground"
          >
            {category}
          </span>
        ))}
      </div>

      <section className="mt-8 grid gap-4">
        {faqItems.map((item) => (
          <details
            key={item.question}
            className="group rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] open:bg-background dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
          >
            <summary className="flex list-none items-start justify-between gap-4">
              <span>
                <span className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  {item.category}
                </span>
                <span className="mt-2 block text-base font-black text-foreground">
                  {item.question}
                </span>
              </span>
              <span className="rounded-[6px] border-2 border-border px-2 py-1 text-xs font-black text-muted-foreground group-open:bg-[#f2cf27] group-open:text-[#111111]">
                <span className="group-open:hidden">열기</span>
                <span className="hidden group-open:inline">닫기</span>
              </span>
            </summary>
            <p className="mt-4 text-sm font-semibold leading-6 text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/dashboard/new" className="bauhaus-button px-5 py-3 text-sm">
          지금 심의 신청
        </Link>
        <Link
          href="/support"
          className="inline-flex items-center rounded-[8px] border-2 border-[#111111] bg-card px-5 py-3 text-sm font-black text-foreground shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
        >
          고객센터 보기
        </Link>
      </div>
    </div>
  );
}
