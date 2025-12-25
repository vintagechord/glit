import Link from "next/link";

import { LoginForm } from "@/features/auth/login-form";

export const metadata = {
  title: "로그인",
};

export default function LoginPage() {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
      <div className="absolute left-8 top-10 h-40 w-40 rounded-full bg-emerald-400/20 blur-[100px] dark:bg-emerald-500/20" />
      <div className="grid w-full max-w-3xl gap-10 rounded-[32px] border border-border/60 bg-card/80 p-10 shadow-[0_30px_100px_rgba(15,23,42,0.12)] lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Welcome Back
          </p>
          <h1 className="font-display text-3xl text-foreground">Onside 로그인</h1>
          <p className="text-sm text-muted-foreground">
            접수 현황과 심의 진행 상황을 실시간으로 확인하세요.
          </p>
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-xs text-muted-foreground">
            아직 계정이 없으신가요?{" "}
            <Link href="/signup" className="font-semibold text-foreground">
              회원가입
            </Link>
            으로 시작하세요.
          </div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
