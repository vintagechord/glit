export const metadata = {
  title: "관리자",
};

import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        관리자 대시보드
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        접수 리스트, 결제 승인, 방송국 상태 관리를 진행하세요.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/submissions"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            접수 관리
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            접수 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            접수 리스트와 결제 승인, 상태 변경을 처리합니다.
          </p>
        </Link>
        <Link
          href="/admin/config"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            설정
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            패키지/방송국 설정
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            패키지 가격과 방송국 매핑을 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/karaoke"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            노래방
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            노래방 등록 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            노래방 등록 접수와 상태를 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/banners"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            배너
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            배너 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            좌측 배너 광고 노출 정보를 관리합니다.
          </p>
        </Link>
      </div>
    </div>
  );
}
