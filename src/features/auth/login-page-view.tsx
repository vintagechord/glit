import { LoginForm } from "./login-form";
import { AuthProviderOptions } from "./auth-provider-options";
import { AuthQueryProvider, SignupSuccessNotice } from "./auth-query";

export type LoginPageProps = {
  searchParams?: Promise<{ next?: string | string[]; signup?: string | string[]; social_error?: string | string[] }>;
};

/** Static sign-in page: the query (`next`, `signup`, `social_error`) is read in the browser. */
export function LoginPageView({ english = false }: LoginPageProps & { english?: boolean } = {}) {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div aria-hidden="true" className="absolute left-8 top-10 hidden h-8 w-32 bg-[#1556a4] sm:block" />
      <div aria-hidden="true" className="absolute right-12 bottom-12 hidden h-16 w-16 bg-[#d9362c] sm:block" />
      <div className="w-full max-w-lg space-y-7 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-10">
        <AuthQueryProvider>
          <div className="space-y-3 text-center sm:space-y-4">
            <SignupSuccessNotice english={english} />
            <h1 className="font-display text-2xl font-black text-foreground sm:text-3xl">{english ? "Log in" : "로그인"}</h1>
          </div>
          <LoginForm socialSlot={<AuthProviderOptions />} />
        </AuthQueryProvider>
      </div>
    </div>
  );
}
