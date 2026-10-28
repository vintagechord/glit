import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { CompleteSignupForm } from "./complete-signup-form";
import { getAuthPageHref, getAuthReturnPath } from "./navigation";
import { requiresSocialSignupCompletion } from "./social-contract";

export type CompleteSignupPageProps = { searchParams?: Promise<{ next?: string | string[] }> };

export async function CompleteSignupView({ searchParams, english = false }: CompleteSignupPageProps & { english?: boolean }) {
  const query = await searchParams;
  const rawNext = Array.isArray(query?.next) ? query.next[0] : query?.next;
  const next = getAuthReturnPath(rawNext, english) ?? `${english ? "/en" : ""}/mypage`;
  const supabase = await createServerSupabase({ allowIncompleteSocialSignup: true });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(getAuthPageHref("login", next, english));
  const consentAlreadySaved = !requiresSocialSignupCompletion(user);
  // An existing, refreshed session can resume its destination immediately.
  if (consentAlreadySaved) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.id === user.id && !requiresSocialSignupCompletion(session.user)) redirect(next);
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-10 sm:px-6 sm:py-16">
      <section className="w-full space-y-6 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] sm:p-8">
        <div className="space-y-3">
          <p className="bauhaus-kicker">{english ? "Join Onside" : "온사이드 회원가입"}</p>
          <h1 className="font-display text-2xl font-black">{consentAlreadySaved ? (english ? "Your agreements are saved" : "가입 동의가 저장되었습니다") : (english ? "One more step to get started" : "이용 동의 후 시작하세요")}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{consentAlreadySaved ? (english ? "Continue below to refresh your session and start using Onside." : "아래 버튼으로 로그인 상태를 갱신하고 온사이드를 이용해주세요.") : (english ? "Your social account is verified. Review and accept the required agreements to complete signup." : "소셜 계정 확인이 완료되었습니다. 필수 약관을 확인하고 동의하면 가입이 완료됩니다.")}</p>
        </div>
        <CompleteSignupForm nextPath={next} english={english} consentAlreadySaved={consentAlreadySaved} />
        <a href={getAuthPageHref("login", next, english)} className="block text-center text-xs font-semibold underline underline-offset-4">{english ? "Use a different account" : "다른 계정으로 로그인"}</a>
      </section>
    </div>
  );
}
