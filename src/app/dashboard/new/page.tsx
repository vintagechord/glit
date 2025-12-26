import Link from "next/link";

export const metadata = {
  title: "새 심의 접수",
};

export default function NewSubmissionPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        New Submission
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        접수 유형을 선택하세요.
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        비회원도 바로 접수할 수 있으며, 로그인 시 내역이 마이페이지에 저장됩니다.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Link
          href="/dashboard/new/album"
          className="rounded-[28px] border border-border/60 bg-card/80 p-6 transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Album Review
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            음반 심의 접수
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            트랙 정보와 음원 파일 업로드를 진행합니다.
          </p>
        </Link>
        <Link
          href="/dashboard/new/mv"
          className="rounded-[28px] border border-border/60 bg-card/80 p-6 transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            MV Review
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            MV 심의 접수
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            유통용/방송용 심의를 구분해 접수할 수 있습니다.
          </p>
        </Link>
      </div>
    </div>
  );
}
