"use client";

import Link from "next/link";
import { useActionState, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { confirmSignupAction, type ActionState } from "./actions";
import { getAuthPageHref } from "./navigation";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./policy";
import { PasswordInput } from "./password-input";
import { AccountEmailForm } from "./account-email-form";

const subscribeToUrl = (changed: () => void) => {
  window.addEventListener("hashchange", changed);
  window.addEventListener("popstate", changed);
  return () => {
    window.removeEventListener("hashchange", changed);
    window.removeEventListener("popstate", changed);
  };
};
const readUrl = () => window.location.href;
const serverUrl = () => "";

export function ConfirmEmailForm({ nextPath }: { nextPath?: string | null }) {
  const english = usePathname().startsWith("/en/");
  const currentUrl = useSyncExternalStore(subscribeToUrl, readUrl, serverUrl);
  const url = currentUrl ? new URL(currentUrl) : null;
  const hash = new URLSearchParams(url?.hash.slice(1));
  const token = hash.get("token_hash") ?? url?.searchParams.get("token_hash");
  const type = hash.get("type") ?? url?.searchParams.get("type") ?? "";
  const signature = hash.get("signature") ?? url?.searchParams.get("signature") ?? "";
  const credential = token ? { token, type, signature } : null;
  const [state, action, pending] = useActionState(confirmSignupAction, {} as ActionState);
  useEffect(() => {
    if (!state.message) return;
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("token_hash");
    url.searchParams.delete("type");
    url.searchParams.delete("signature");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [state.message]);

  if (state.message) return <div className="space-y-5">
    <p role="status" className="text-sm leading-6">{state.message}</p>
    <Link href={getAuthPageHref("login", nextPath, english)} className="bauhaus-button inline-flex w-full justify-center px-5 py-3 text-sm">{english ? "Log in" : "로그인"}</Link>
  </div>;

  return <div className="space-y-7">
    {credential && <form action={action} className="space-y-4">
      <input type="hidden" name="token_hash" value={credential.token} />
      <input type="hidden" name="type" value={credential.type} />
      <input type="hidden" name="signature" value={credential.signature} />
      <input type="hidden" name="locale" value={english ? "en" : "ko"} />
      <p className="text-sm leading-6 text-muted-foreground">{english ? "If you requested signup, choose your password and confirm below. Opening this page alone does not verify your email." : "본인이 회원가입을 신청했다면 비밀번호를 설정하고 아래 버튼을 눌러주세요. 버튼을 누르면 이메일 확인과 가입이 완료됩니다."}</p>
      <label htmlFor="signup-new-password" className="block text-sm font-semibold">{english ? "New password" : "비밀번호"}</label>
      <PasswordInput id="signup-new-password" name="newPassword" label={english ? "New password" : "비밀번호"} english={english} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm" />
      {state.fieldErrors?.newPassword && <p className="text-sm text-red-500">{state.fieldErrors.newPassword}</p>}
      <label htmlFor="signup-confirm-password" className="block text-sm font-semibold">{english ? "Confirm password" : "비밀번호 확인"}</label>
      <PasswordInput id="signup-confirm-password" name="confirmPassword" label={english ? "Confirm password" : "비밀번호 확인"} english={english} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm" />
      {state.fieldErrors?.confirmPassword && <p className="text-sm text-red-500">{state.fieldErrors.confirmPassword}</p>}
      <p className="text-xs text-muted-foreground">{english ? `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.` : `${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH}자로 설정해주세요.`}</p>
      {state.error && <p role="alert" className="text-sm text-red-500">{state.error}</p>}
      <button type="submit" disabled={pending} className="bauhaus-button w-full px-5 py-3 text-sm disabled:opacity-60">{pending ? english ? "Verifying..." : "확인 중..." : english ? "Verify email and complete signup" : "이메일 확인하고 가입 완료"}</button>
    </form>}
    <div className={credential ? "border-t-2 border-border pt-6" : ""}>
      <h2 className="mb-4 font-semibold">{english ? "Request a new verification email" : "인증 메일 다시 받기"}</h2>
      <AccountEmailForm nextPath={nextPath} />
    </div>
  </div>;
}
