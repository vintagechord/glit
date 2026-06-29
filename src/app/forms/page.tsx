import Link from "next/link";

export const metadata = {
  title: "예전 온사이드 바로가기",
};

export default function FormsPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <p className="bauhaus-kicker">Old Onside</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        예전 온사이드 주소 바로가기
      </h1>
      <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-muted-foreground">
        이전 버전의 온사이드 사이트가 편하신 경우 예전 사이트에서 접수해주셔도 심의는 동일하게 진행됩니다.
        <span className="mt-2 block">
          구버전과 신버전은 오픈 후 1년간 동시에 운영됩니다.
        </span>
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
        >
          예전 온사이드 주소 바로가기
          <span aria-hidden>↗</span>
        </Link>
        <span className="text-xs text-muted-foreground">
          진행 현황과 결제 기록 관리는 온라인 접수가 더 빠릅니다.
        </span>
      </div>

      <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-6 text-sm text-black shadow-[6px_6px_0_#111111] dark:shadow-[6px_6px_0_#f2cf27]">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white text-base font-black text-black live-blink">
            !
          </div>
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-normal text-black">
              필독
            </p>
            <p className="text-sm font-semibold text-slate-900">
              예전 온사이드 사이트에서도 음반·뮤직비디오 심의 접수가 가능합니다.
            </p>
            <p className="text-xs text-black/80">
              접수 방식만 다르고 심의 진행은 동일하게 처리됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[10px] border-2 border-[#111111] bg-card p-6 text-sm font-semibold text-foreground shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]">
        <p>
          새 온사이드에서는 신청, 결제, 진행 현황, 결과 확인을 한 곳에서 처리할 수 있습니다.
        </p>
        <p className="mt-2 text-muted-foreground">
          예전 사이트 이용이 더 편하신 경우에만 위 바로가기 버튼을 사용해주세요.
        </p>
      </div>
    </div>
  );
}
