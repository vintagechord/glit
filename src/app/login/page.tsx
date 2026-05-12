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
    <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="grid w-full max-w-3xl gap-7 rounded-[8px] border border-[#d8e1ef] bg-white p-6 dark:border-white/10 dark:bg-[#111827] sm:gap-10 sm:p-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3 sm:space-y-4">
          {showSignupSuccess ? (
            <div className="rounded-[8px] border border-[#cbdde8] bg-[#edf4f7] px-4 py-3 text-sm font-semibold text-[#2f6f9f]">
              회원가입이 완료되었습니다. 로그인 후 접수와 결과 확인을 이어서 진행할 수 있습니다.
            </div>
          ) : null}
          <p className="text-sm font-semibold text-[#2f6f9f]">Welcome Back</p>
          <h1 className="text-2xl font-semibold text-[#2f3a4d] dark:text-white sm:text-3xl">
            온사이드 로그인
          </h1>
          <p className="break-keep text-sm leading-6 text-[#667085] dark:text-white/64">
            로그인하면 접수 현황과 결과 안내를 한 곳에서 확인할 수 있습니다.
          </p>
        </div>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
