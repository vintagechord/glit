import Link from "next/link";

export const metadata = {
  title: "새 심의 접수",
};

export default function NewSubmissionPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        New Submission
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        접수 유형을 선택하세요.
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        비회원도 바로 접수할 수 있으며, 로그인 시 내역이 마이페이지에 저장됩니다.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <Link
          href="/dashboard/new/album"
          className="rounded-[28px] border border-transparent bg-[#8fe38f] p-6 text-[#111111] transition hover:-translate-y-1"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-black/70">
            Album Review
          </p>
          <h2 className="mt-3 text-xl font-semibold">음반 심의</h2>
          <p className="mt-2 text-sm text-black/80">
            트랙 정보와 음원 파일 업로드를 진행합니다.
          </p>
        </Link>
        <Link
          href="/dashboard/new/mv"
          className="rounded-[28px] border border-transparent bg-[#f6d64a] p-6 text-[#111111] transition hover:-translate-y-1"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-black/70">
            M/V Review
          </p>
          <h2 className="mt-3 text-xl font-semibold">M/V 심의</h2>
          <p className="mt-2 text-sm text-black/80">
            유통용/방송용 심의를 구분해 접수할 수 있습니다.
          </p>
        </Link>
        <Link
          href="/dashboard/new/album?mode=oneclick"
          className="rounded-[28px] border border-transparent bg-[#4f56d8] p-6 text-[#ecf2ff] transition hover:-translate-y-1"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ecf2ff]/75">
            One Click
          </p>
          <h2 className="mt-3 text-xl font-semibold">원클릭</h2>
          <p className="mt-2 text-sm text-[#ecf2ff]/85">
            멜론 링크와 음원 파일만 제출하는 간편 접수입니다.
          </p>
        </Link>
      </div>
    </div>
  );
}
