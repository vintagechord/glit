"use client";

import { useActionState, useState } from "react";

import { resetPasswordAction, type ActionState } from "@/features/auth/actions";

const initialState: ActionState = {};

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);
  const [email, setEmail] = useState("");

  return (
    <div className="relative mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-16">
      <div className="absolute right-8 top-12 h-40 w-40 rounded-full bg-amber-300/25 blur-[100px] dark:bg-amber-400/20" />
      <div className="w-full max-w-xl space-y-6 rounded-[32px] border border-border/60 bg-card/80 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Forgot Password
          </p>
          <h1 className="font-display text-2xl text-foreground">비밀번호 찾기</h1>
          <p className="text-sm text-muted-foreground">
            회원가입시 입력하셨던 이메일 주소를 정확히 입력해야 합니다.
            <br />
            입력된 이메일로 비밀번호 재설정 링크를 보내드립니다.
          </p>
        </div>

        {state.error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
            {state.error}
          </div>
        )}
        {state.message && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
            {state.message}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              이메일
            </label>
            <input
              name="resetEmail"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="이메일을 입력하세요"
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
            {state.fieldErrors?.resetEmail && (
              <p className="text-xs text-red-500">{state.fieldErrors.resetEmail}</p>
            )}
          </div>
          <button
            type="submit"
            className="w-full rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
          >
            비밀번호 재설정 메일 보내기
          </button>
          <p className="text-[11px] text-muted-foreground">
            입력한 이메일로 비밀번호 재설정 링크가 전송됩니다. 메일함(스팸 포함)을 확인해주세요.
          </p>
        </form>
      </div>
    </div>
  );
}
