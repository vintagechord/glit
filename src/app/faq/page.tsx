import Link from "next/link";
import { Plus } from "lucide-react";

import { faqItems } from "@/lib/onside-content";

export const metadata = {
  title: "FAQ",
};

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">FAQ</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        자주 묻는 질문
      </h1>
      <section className="mt-7 grid gap-3">
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
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground transition group-open:bg-[#f2cf27] group-open:text-[#111111]">
                <Plus className="h-4 w-4 transition-transform group-open:rotate-45" aria-hidden="true" />
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
          심의 신청
        </Link>
        <Link
          href="/support"
          className="inline-flex items-center rounded-[8px] border-2 border-[#111111] bg-card px-5 py-3 text-sm font-black text-foreground shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
        >
          1:1 문의
        </Link>
      </div>
    </div>
  );
}
