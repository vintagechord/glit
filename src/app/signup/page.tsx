import Link from "next/link";

import { SignupForm } from "@/features/auth/signup-form";

export const metadata = {
  title: "회원가입",
};

export default function SignupPage() {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="absolute right-8 top-12 h-40 w-40 rounded-full bg-[#f6d64a] blur-[100px] dark:bg-[#f6d64a]" />
      <div className="grid w-full max-w-4xl gap-7 rounded-[28px] border border-border/60 bg-card/80 p-6 shadow-[0_30px_100px_rgba(15,23,42,0.12)] sm:gap-10 sm:rounded-[32px] sm:p-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3 sm:space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Get Started
          </p>
          <h1 className="font-display text-2xl text-foreground sm:text-3xl">온사이드 회원가입</h1>
          <p className="text-sm text-muted-foreground">
            심의 접수와 결제, 결과 통보, 승인 기록 아카이브까지 온사이드에서 한 번에
            관리하세요.
          </p>
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-xs text-muted-foreground">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="font-semibold text-foreground">
              로그인
            </Link>
            으로 이동하세요.
          </div>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}
