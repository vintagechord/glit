import { SignupForm } from "./signup-form";
import { AuthProviderOptions } from "./auth-provider-options";

export type SignupPageProps = { searchParams?: Promise<{ next?: string | string[] }> };

export async function SignupPageView({ searchParams, english = false }: SignupPageProps & { english?: boolean }) {
  const query = (await searchParams) ?? {};
  const nextPath = Array.isArray(query.next) ? query.next[0] : query.next;
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div aria-hidden="true" className="absolute right-8 top-12 h-16 w-16 bg-[#f2cf27]" />
      <div aria-hidden="true" className="absolute left-10 bottom-14 hidden h-8 w-32 bg-[#1556a4] sm:block" />
      <div className="w-full max-w-2xl space-y-7 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-10">
        <div className="space-y-3 text-center sm:space-y-4">
          <p className="bauhaus-kicker mx-auto">{english ? "Sign up" : "회원가입"}</p>
          <h1 className="font-display text-2xl font-black text-foreground sm:text-3xl">{english ? "Get started with Onside" : "온사이드 시작하기"}</h1>
        </div>
        <AuthProviderOptions nextPath={nextPath} mode="signup" />
        <SignupForm nextPath={nextPath} />
      </div>
    </div>
  );
}
