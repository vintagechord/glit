"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  resetPasswordAction,
  type ActionState,
} from "@/features/auth/actions";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_18px_40px_rgba(0,113,227,0.22)] transition hover:-translate-y-0.5 hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]"
      disabled={pending}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-transparent dark:border-[#00101f]/30" />
          <span>메일 발송 중...</span>
        </span>
      ) : (
        "재설정 메일 보내기"
      )}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);
  const [email, setEmail] = useState("");

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
      <div className="absolute left-6 top-10 h-40 w-40 rounded-full bg-[#0071e3]/10 blur-[100px] dark:bg-[#2997ff]/16" />
      <div className="absolute bottom-6 right-6 h-44 w-44 rounded-full bg-white blur-[110px] dark:bg-white/6" />

      <div className="relative w-full max-w-xl rounded-[36px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(245,245,247,0.98))] p-8 shadow-[0_32px_100px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(29,29,31,0.94),rgba(0,0,0,0.98))] dark:shadow-none sm:p-10">
        <div className="space-y-3 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
            Password Reset
          </p>
          <h1 className="font-display text-3xl leading-tight tracking-[-0.03em] text-foreground">
            비밀번호를 다시 설정하세요
          </h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
            가입한 이메일을 입력하면 재설정 링크를 보내드립니다.
          </p>
        </div>

        <form action={formAction} className="mt-8 space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="reset-email"
              className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
            >
              이메일
            </label>
            <input
              id="reset-email"
              name="resetEmail"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-[20px] border border-border/70 bg-white/86 px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary dark:bg-white/6"
            />
            {state.fieldErrors?.resetEmail ? (
              <p className="text-xs text-red-500">{state.fieldErrors.resetEmail}</p>
            ) : null}
          </div>

          {state.error ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-600 dark:text-red-300">
              {state.error}
            </div>
          ) : null}

          {state.message ? (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              {state.message}
            </div>
          ) : null}

          <SubmitButton />
        </form>

        <div className="mt-6 flex justify-center">
          <Link
            href="/login"
            className="inline-flex items-center rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary dark:hover:text-[#2997ff]"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
