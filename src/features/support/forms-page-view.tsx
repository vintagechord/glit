import Link from "next/link";

export function FormsPageView({ localePrefix = "" }: { localePrefix?: string } = {}) {
  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="font-display text-3xl font-black text-foreground">
        예전 온사이드 사이트에서 접수하기
      </h1>
      <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-muted-foreground">
        기존 사이트에서 접수한 신청은 해당 사이트의 접수번호와 제출 안내를 따라 진행해주세요.
      </p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        제출 경로나 진행상황을 확인하려면 접수번호를 준비해 고객센터에 문의해주세요.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="예전 온사이드 사이트 열기 (새 창)"
          className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
        >
          예전 사이트 열기 <span aria-hidden="true">→</span>
        </Link>
        <Link href={`${localePrefix}/support`} className="inline-flex min-h-11 items-center underline underline-offset-4">
          접수 관련 문의
        </Link>
      </div>
    </div>
  );
}
