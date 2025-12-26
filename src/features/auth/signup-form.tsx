"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signupAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          담당자명
        </label>
        <input
          name="name"
          type="text"
          required
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-500">{state.fieldErrors.name}</p>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          회사/기획사
        </label>
        <input
          name="company"
          type="text"
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          연락처
        </label>
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          required
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {state.fieldErrors?.phone && (
          <p className="text-xs text-red-500">{state.fieldErrors.phone}</p>
        )}
      </div>
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
          autoComplete="new-password"
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
      {state.message && (
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-600">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        className="w-full rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
      >
        회원가입
      </button>
      <p className="text-center text-xs text-muted-foreground">
        이미 계정이 있나요?{" "}
        <Link href="/login" className="font-semibold text-foreground">
          로그인
        </Link>
      </p>
    </form>
  );
}
