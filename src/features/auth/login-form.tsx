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
        className="h-12 w-full rounded-[8px] bg-[#1268b3] px-5 text-sm font-semibold text-white transition hover:bg-[#0f5797] disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
      >
        {pending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />
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
          <label className="text-sm font-semibold text-[#26324a] dark:text-white">
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
            className="w-full rounded-[8px] border border-[#c9d6e8] bg-white px-4 py-3 text-sm text-[#26324a] outline-none transition focus:border-[#1268b3] dark:border-white/16 dark:bg-[#0f172a] dark:text-white"
          />
          {state.fieldErrors?.email && (
            <p className="text-xs text-red-500">{state.fieldErrors.email}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-[#26324a] dark:text-white">
            비밀번호
          </label>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-[8px] border border-[#c9d6e8] bg-white px-4 py-3 text-sm text-[#26324a] outline-none transition focus:border-[#1268b3] dark:border-white/16 dark:bg-[#0f172a] dark:text-white"
          />
          {state.fieldErrors?.password && (
            <p className="text-xs text-red-500">{state.fieldErrors.password}</p>
          )}
        </div>
        {state.error && (
          <p className="rounded-[8px] border border-[#f1b7b2] bg-[#fff2f1] px-4 py-2 text-xs font-semibold text-[#c0332a]">
            {state.error}
          </p>
        )}
        <SubmitButton />
      </form>
      <div className="space-y-2 rounded-[8px] border border-[#edf1f7] bg-[#fbfcfe] px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <div className="flex justify-center">
          <Link
            href="/forgot-password"
            className="inline-flex w-full justify-center rounded-[8px] border border-[#c9d6e8] bg-white px-4 py-2 text-xs font-semibold text-[#26324a] transition hover:border-[#1268b3] hover:text-[#1268b3] dark:border-white/16 dark:bg-[#111827] dark:text-white sm:w-auto"
          >
            비밀번호 찾기
          </Link>
        </div>
      </div>
      <div className="text-center text-sm text-[#667085] dark:text-white/60">
        <span>비회원으로 접수한 경우 </span>
        <TrackLookupModalTrigger
          label="코드입력"
          modalTitle="비회원 코드 입력"
          className="inline-flex items-center rounded-[8px] border border-[#c9d6e8] bg-white px-3 py-1 text-xs font-semibold text-[#26324a] transition hover:border-[#1268b3] hover:text-[#1268b3]"
        />
        <span> 으로 확인 가능합니다.</span>
      </div>
    </div>
  );
}
