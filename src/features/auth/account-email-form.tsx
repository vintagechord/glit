"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { resendSignupAction, type ActionState } from "./actions";
import { getAuthPageHref } from "./navigation";
import { useAuthNotice } from "./use-auth-notice";

export function AccountEmailForm({ nextPath }: { nextPath?: string | null }) {
  const english = usePathname().startsWith("/en/");
  const [retryUntil, setRetryUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [state, action, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    const result = await resendSignupAction(previous, form);
    const seconds = result.retryAfterSeconds ?? 0;
    setRetryUntil(seconds ? Date.now() + seconds * 1000 : 0);
    setRemaining(seconds);
    return result;
  }, {} as ActionState);
  useAuthNotice(state, english);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="locale" value={english ? "en" : "ko"} />
    <input type="hidden" name="next" value={nextPath ?? ""} />
    <p className="text-sm leading-6 text-muted-foreground">{english ? "Enter the email used for signup. Use the newest verification email to set your password and complete signup." : "회원가입에 사용한 이메일을 입력해주세요. 가장 최근 인증 메일에서 비밀번호를 설정하면 가입이 완료됩니다."}</p>
    <label htmlFor="signup-email" className="block text-sm font-semibold">{english ? "Email" : "이메일"}</label>
    <input id="signup-email" name="email" type="email" autoComplete="email" maxLength={254} required aria-invalid={Boolean(state.fieldErrors?.email)} aria-describedby={state.fieldErrors?.email ? "signup-email-error" : undefined} className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm" />
    {state.fieldErrors?.email && <p id="signup-email-error" className="text-sm text-red-500">{state.fieldErrors.email}</p>}
    {state.error && <p role="alert" className="text-sm text-red-500">{state.error}</p>}
    {state.message && <p role="status" className="rounded-[8px] border border-emerald-600 p-3 text-sm">{state.message}</p>}
    <button type="submit" disabled={pending || remaining > 0} className="bauhaus-button w-full px-5 py-3 text-sm disabled:opacity-60">{pending ? english ? "Requesting..." : "요청 중..." : remaining > 0 ? `${remaining}${english ? " seconds until retry" : "초 후 다시 보내기"}` : english ? "Send email" : "이메일로 받기"}</button>
    <div className="flex flex-wrap justify-center gap-4 text-sm font-semibold underline underline-offset-4">
      <Link href={getAuthPageHref("login", nextPath, english)}>{english ? "Log in" : "로그인"}</Link>
      <Link href={getAuthPageHref("forgot-password", nextPath, english)}>{english ? "Reset password" : "비밀번호 찾기"}</Link>
    </div>
  </form>;
}
