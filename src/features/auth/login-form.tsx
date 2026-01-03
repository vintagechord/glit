"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { TrackLookupModalTrigger } from "@/features/track/track-lookup-modal";

import { loginAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [emailValue, setEmailValue] = useState("");

  return (
    <div className="space-y-5">
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
          value={emailValue}
          onChange={(event) => {
            setEmailValue(event.target.value);
          }}
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
      </form>
      <div className="space-y-2 rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
        <div className="flex justify-center">
          <Link
            href="/forgot-password"
            className="inline-flex w-full justify-center rounded-full border border-border/70 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-foreground hover:text-background sm:w-auto"
          >
            비밀번호 찾기
          </Link>
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        <span>비회원으로 접수한 경우 </span>
        <TrackLookupModalTrigger
          label="코드입력"
          modalTitle="비회원 코드 입력"
          className="inline-flex items-center rounded-full border border-foreground/40 px-3 py-1 text-xs font-semibold text-foreground transition hover:bg-foreground hover:text-background"
        />
        <span> 으로 확인 가능합니다.</span>
      </div>
    </div>
  );
}
