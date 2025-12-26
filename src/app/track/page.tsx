import Link from "next/link";

import { TrackLookupForm } from "@/features/submissions/track-lookup-form";

export const metadata = {
  title: "접수 진행 상황 조회",
};

export default function TrackPage() {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
      <div className="absolute left-10 top-8 h-40 w-40 rounded-full bg-amber-300/30 blur-[110px] dark:bg-amber-400/20" />
      <div className="grid w-full max-w-3xl gap-10 rounded-[32px] border border-border/60 bg-card/80 p-10 shadow-[0_30px_100px_rgba(15,23,42,0.12)] lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Track Status
          </p>
          <h1 className="font-display text-3xl text-foreground">
            접수 진행 상황 조회
          </h1>
          <p className="text-sm text-muted-foreground">
            비회원 접수 시 발급된 조회 코드를 입력하면 진행 상태를 확인할 수
            있습니다.
          </p>
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-xs text-muted-foreground">
            로그인 사용자는{" "}
            <Link href="/dashboard" className="font-semibold text-foreground">
              마이페이지
            </Link>
            에서 모든 접수 내역을 확인할 수 있습니다.
          </div>
        </div>
        <TrackLookupForm />
      </div>
    </div>
  );
}
