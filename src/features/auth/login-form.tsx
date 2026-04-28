"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TrackLookupModalTrigger } from "@/features/track/track-lookup-modal";

import { loginAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function LoginForm({ nextPath }: { nextPath?: string | null } = {}) {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [emailValue, setEmailValue] = useState("");

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
      <form action={formAction} className="space-y-5">
        {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
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
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
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
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.password && (
            <p className="text-xs text-red-500">{state.fieldErrors.password}</p>
          )}
        </div>
        {state.error && (
          <p className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-2 text-xs font-semibold text-[#d9362c]">
            {state.error}
          </p>
        )}
        <SubmitButton />
      </form>
      <div className="space-y-2 rounded-[8px] border-2 border-border bg-background/70 px-4 py-3">
        <div className="flex justify-center">
          <Link
            href="/forgot-password"
            className="inline-flex w-full justify-center rounded-[8px] border-2 border-border px-4 py-2 text-xs font-black text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white sm:w-auto dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
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
          className="inline-flex items-center rounded-[8px] border-2 border-foreground/60 px-3 py-1 text-xs font-black text-foreground transition hover:bg-foreground hover:text-background"
        />
        <span> 으로 확인 가능합니다.</span>
      </div>
    </div>
  );
}
