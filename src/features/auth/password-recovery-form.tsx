"use client";

import Link from "next/link";
import { useActionState, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { completePasswordRecoveryAction, type ActionState } from "./actions";
import { getAuthPageHref } from "./navigation";
import { readRecoveryCredential } from "./recovery";
import { PasswordInput } from "./password-input";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./policy";

const subscribe = (changed: () => void) => {
  window.addEventListener("hashchange", changed);
  window.addEventListener("popstate", changed);
  return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("popstate", changed); };
};
const readUrl = () => window.location.href;
const serverUrl = () => "";

export function PasswordRecoveryForm({ nextPath }: { nextPath?: string | null }) {
  const english = usePathname().startsWith("/en/");
  const currentUrl = useSyncExternalStore(subscribe, readUrl, serverUrl);
  const credential = currentUrl ? readRecoveryCredential(new URL(currentUrl)) : null;
  const token = credential?.token ?? "";
  const signature = credential?.signature ?? "";
  const valid = Boolean(credential);
  const [state, action, pending] = useActionState(completePasswordRecoveryAction, {} as ActionState);
  useEffect(() => {
    if (!state.message) return;
    const url = new URL(window.location.href);
    url.hash = "";
    for (const key of ["token_hash", "token", "type", "signature", "code", "sb_flow_id"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [state.message]);
  if (state.message) return <div className="space-y-5">
    <p role="status">{english ? "Your password has been changed. Log in with your new password." : state.message}</p>
    <Link className="bauhaus-button inline-flex w-full justify-center px-5 py-3" href={getAuthPageHref("login", nextPath, english)}>{english ? "Log in" : "로그인"}</Link>
  </div>;
  return <div className="space-y-5">
    <h1 className="text-center font-display text-3xl font-black">{english ? "Set a new password" : "새 비밀번호 설정"}</h1>
    {valid ? <form action={action} className="space-y-4">
      <input type="hidden" name="token_hash" value={token} />
      <input type="hidden" name="type" value="recovery" />
      <input type="hidden" name="signature" value={signature} />
      <input type="hidden" name="locale" value={english ? "en" : "ko"} />
      <p className="text-sm text-muted-foreground">{english ? "Enter your new password, then confirm below. Opening this page does not use your reset link." : "새 비밀번호를 입력한 뒤 변경 버튼을 눌러주세요. 이 페이지를 열기만 해서는 재설정 링크가 사용되지 않습니다."}</p>
      <label htmlFor="reset-new-password" className="block text-sm font-semibold">{english ? "New password" : "새 비밀번호"}</label>
      <PasswordInput id="reset-new-password" name="newPassword" label={english ? "New password" : "새 비밀번호"} english={english} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3" />
      {state.fieldErrors?.newPassword && <p role="alert">{state.fieldErrors.newPassword}</p>}
      <label htmlFor="reset-confirm-password" className="block text-sm font-semibold">{english ? "Confirm password" : "새 비밀번호 확인"}</label>
      <PasswordInput id="reset-confirm-password" name="confirmPassword" label={english ? "Confirm password" : "새 비밀번호 확인"} english={english} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3" />
      {state.fieldErrors?.confirmPassword && <p role="alert">{state.fieldErrors.confirmPassword}</p>}
      <p className="text-xs text-muted-foreground">{english ? `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.` : `${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH}자로 설정해주세요.`}</p>
      {state.error && <p role="alert" className="text-sm text-red-500">{state.error}</p>}
      <button type="submit" disabled={pending} className="bauhaus-button w-full px-5 py-3 disabled:opacity-60">{pending ? english ? "Changing password..." : "변경 중..." : english ? "Change password" : "비밀번호 변경"}</button>
    </form> : currentUrl ? <p role="alert">{english ? "This reset link is invalid or outdated. Request a new email below." : "유효하지 않거나 이전 방식의 재설정 링크입니다. 아래에서 새 메일을 요청해주세요."}</p> : <p>{english ? "Loading..." : "불러오는 중..."}</p>}
    <Link className="inline-flex underline underline-offset-4" href={getAuthPageHref("forgot-password", nextPath, english)}>{english ? "Request a new reset email" : "재설정 메일 다시 받기"}</Link>
  </div>;
}
