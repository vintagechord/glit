import Link from "next/link";

import { SignupForm } from "@/features/auth/signup-form";

export const metadata = {
  title: "회원가입",
};

export default function SignupPage() {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div aria-hidden="true" className="absolute right-8 top-12 h-16 w-16 bg-[#f2cf27]" />
      <div aria-hidden="true" className="absolute left-10 bottom-14 h-8 w-32 bg-[#1556a4]" />
      <div className="grid w-full max-w-4xl gap-7 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:gap-10 sm:p-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3 sm:space-y-4">
          <p className="bauhaus-kicker">
            Get Started
          </p>
          <h1 className="font-display text-2xl font-black text-foreground sm:text-3xl">온사이드 회원가입</h1>
          <p className="text-sm font-semibold leading-6 text-muted-foreground">
            심의 접수와 결제, 결과 통보, 승인 기록 아카이브까지 온사이드에서 한 번에
            관리하세요.
          </p>
          <div className="rounded-[8px] border-2 border-dashed border-[#111111] bg-background/70 p-4 text-xs font-semibold text-muted-foreground dark:border-[#f2cf27]">
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
