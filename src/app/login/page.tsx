import { LoginForm } from "@/features/auth/login-form";
export const metadata = {
  title: "로그인",
};

type LoginPageProps = {
  searchParams?: Promise<{ next?: string | string[]; signup?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const nextRaw = Array.isArray(resolvedSearchParams.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams.next;
  const nextPath =
    typeof nextRaw === "string" &&
    nextRaw.startsWith("/") &&
    !nextRaw.startsWith("//")
      ? nextRaw
      : null;
  const signupRaw = Array.isArray(resolvedSearchParams.signup)
    ? resolvedSearchParams.signup[0]
    : resolvedSearchParams.signup;
  const showSignupSuccess = signupRaw === "success";

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div aria-hidden="true" className="absolute left-8 top-10 h-8 w-32 bg-[#1556a4]" />
      <div aria-hidden="true" className="absolute right-12 bottom-12 h-16 w-16 bg-[#d9362c]" />
      <div className="grid w-full max-w-3xl gap-7 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:gap-10 sm:p-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3 sm:space-y-4">
          {showSignupSuccess ? (
            <div className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-sm font-semibold text-[#111111] dark:border-[#f2cf27]">
              회원가입이 완료되었습니다. 로그인 후 접수와 결과 확인을 이어서 진행할 수 있습니다.
            </div>
          ) : null}
          <p className="bauhaus-kicker">
            Welcome Back
          </p>
          <h1 className="font-display text-2xl font-black text-foreground sm:text-3xl">온사이드 로그인</h1>
          <p className="text-sm font-semibold leading-6 text-muted-foreground">
            간편한 접수 이후 심의 진행 상황을 실시간으로 확인하고, 나의 모든 기록을
            온사이드에 아카이빙하세요.
          </p>
        </div>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
