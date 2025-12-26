"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          이메일
        </label>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {state.fieldErrors?.email && (
          <p className="text-xs text-red-500">{state.fieldErrors.email}</p>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          비밀번호
        </label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {state.fieldErrors?.password && (
          <p className="text-xs text-red-500">{state.fieldErrors.password}</p>
        )}
      </div>
      {state.error && (
        <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        className="w-full rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
      >
        로그인
      </button>
      <p className="text-center text-xs text-muted-foreground">
        아직 계정이 없나요?{" "}
        <Link href="/signup" className="font-semibold text-foreground">
          회원가입
        </Link>
      </p>
    </form>
  );
}
