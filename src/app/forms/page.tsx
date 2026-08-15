import Link from "next/link";

export const metadata = {
  title: "예전 온사이드 사이트에서 접수하기",
};

export default function FormsPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="font-display text-3xl font-black text-foreground">
        예전 온사이드 사이트에서 접수하기
      </h1>
      <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-muted-foreground">
        구버전과 신버전은 오픈 후 1년간 함께 운영되며, 접수 후 심의 절차는 동일합니다.
      </p>

      <div className="mt-6">
        <Link
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="예전 온사이드 사이트 열기 (새 창)"
          className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
        >
          예전 사이트 열기 <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
