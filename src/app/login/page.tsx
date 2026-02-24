import { LoginForm } from "@/features/auth/login-form";
export const metadata = {
  title: "로그인",
};

type LoginPageProps = {
  searchParams?: { next?: string | string[] };
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  const nextRaw = Array.isArray(searchParams?.next)
    ? searchParams?.next[0]
    : searchParams?.next;
  const nextPath =
    typeof nextRaw === "string" &&
    nextRaw.startsWith("/") &&
    !nextRaw.startsWith("//")
      ? nextRaw
      : null;

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="absolute left-8 top-10 h-40 w-40 rounded-full bg-emerald-400/20 blur-[100px] dark:bg-emerald-500/20" />
      <div className="grid w-full max-w-3xl gap-7 rounded-[28px] border border-border/60 bg-card/80 p-6 shadow-[0_30px_100px_rgba(15,23,42,0.12)] sm:gap-10 sm:rounded-[32px] sm:p-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3 sm:space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Welcome Back
          </p>
          <h1 className="font-display text-2xl text-foreground sm:text-3xl">온사이드 로그인</h1>
          <p className="text-sm text-muted-foreground">
            간편한 접수 이후 심의 진행 상황을 실시간으로 확인하고, 나의 모든 기록을
            온사이드에 아카이빙하세요.
          </p>
        </div>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
