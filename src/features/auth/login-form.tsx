"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { TrackLookupModalTrigger } from "@/features/track/track-lookup-modal";

import { loginAction, type ActionState } from "./actions";
import { getAuthPageHref, getAuthReturnPath } from "./navigation";
import { PasswordInput } from "./password-input";

const initialState: ActionState = {};

export function LoginForm({ nextPath, socialSlot }: { nextPath?: string | null; socialSlot?: ReactNode } = {}) {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [emailValue, setEmailValue] = useState("");
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const effectiveNextPath = getAuthReturnPath(nextPath, isEnglishRoute);
  const signupHref = getAuthPageHref("signup", effectiveNextPath, isEnglishRoute);
  const forgotPasswordHref = getAuthPageHref("forgot-password", effectiveNextPath, isEnglishRoute);

  const SubmitButton = () => {
    const { pending } = useFormStatus();
    return (
      <button
        type="submit"
        className="bauhaus-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
      >
        {pending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-background/40 border-t-transparent" />
            <span>로그인 중...</span>
          </span>
        ) : (
          "로그인"
        )}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {socialSlot}
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="locale" value={isEnglishRoute ? "en" : "ko"} />
        {effectiveNextPath ? (
          <input type="hidden" name="next" value={effectiveNextPath} />
        ) : null}
        <div className="space-y-2">
          <label
            htmlFor="login-email"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          >
            이메일
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={state.fieldErrors?.email ? "login-email-error" : undefined}
            value={emailValue}
            onChange={(event) => {
              setEmailValue(event.target.value);
            }}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.email && (
            <p id="login-email-error" className="text-xs text-red-500">{state.fieldErrors.email}</p>
          )}
        </div>
        <div className="space-y-2">
          <label
            htmlFor="login-password"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          >
            비밀번호
          </label>
          <PasswordInput
            label={isEnglishRoute ? "Password" : "비밀번호"}
            english={isEnglishRoute}
            id="login-password"
            name="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby={state.fieldErrors?.password ? "login-password-error" : undefined}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.password && (
            <p id="login-password-error" className="text-xs text-red-500">{state.fieldErrors.password}</p>
          )}
        </div>
        {state.error && (
          <p role="alert" className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-2 text-xs font-semibold text-[#d9362c]">
            {state.error}
          </p>
        )}
        <SubmitButton />
      </form>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={forgotPasswordHref}
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-border px-3 py-2 text-xs font-black text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
        >
          비밀번호 찾기
        </Link>
        <Link
          href={signupHref}
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5"
        >
          회원가입
        </Link>
      </div>
      <Link href={getAuthPageHref("confirm-email", effectiveNextPath, isEnglishRoute)} className="block text-center text-xs font-semibold underline underline-offset-4">
        {isEnglishRoute ? "Resend signup verification email" : "회원가입 인증 메일 다시 받기"}
      </Link>
      <div className="grid text-center text-muted-foreground">
        <TrackLookupModalTrigger
          label="비회원 조회"
          modalTitle="비회원 접수 조회"
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-foreground/60 px-3 py-2 text-xs font-black text-foreground transition hover:bg-foreground hover:text-background"
        />
      </div>
    </div>
  );
}
