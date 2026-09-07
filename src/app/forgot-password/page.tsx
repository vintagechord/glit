"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";

import {
  resetPasswordAction,
  type ActionState,
} from "@/features/auth/actions";

const initialState: ActionState = {};

function SubmitButton({ retrySeconds }: { retrySeconds: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="bauhaus-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending || retrySeconds > 0}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-transparent dark:border-[#00101f]/30" />
          <span>메일 발송 중...</span>
        </span>
      ) : retrySeconds > 0 ? (
        `${retrySeconds}초 후 다시 보내기`
      ) : (
        "링크 보내기"
      )}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [state, formAction] = useActionState(
    async (previousState: ActionState, formData: FormData) => {
      const result = await resetPasswordAction(previousState, formData);
      const seconds = Math.max(0, result.retryAfterSeconds ?? 0);
      setRetrySeconds(seconds);
      setRetryAt(seconds ? Date.now() + seconds * 1000 : 0);
      return result;
    },
    initialState,
  );
  const pathname = usePathname();
  const localePrefix = pathname.startsWith("/en/") ? "/en" : "";

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRetrySeconds(remaining);
      if (!remaining) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
      <div aria-hidden="true" className="absolute left-6 top-10 hidden h-8 w-32 bg-[#1556a4] sm:block" />
      <div aria-hidden="true" className="absolute bottom-6 right-6 hidden h-16 w-16 bg-[#f2cf27] sm:block" />

      <div className="relative w-full max-w-xl rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-10">
        <div className="text-center">
          <h1 className="font-display text-3xl font-black leading-tight tracking-normal text-foreground">
            재설정 링크 받기
          </h1>
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
              className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
            />
            {state.fieldErrors?.resetEmail ? (
              <p className="text-xs text-red-500">{state.fieldErrors.resetEmail}</p>
            ) : null}
          </div>

          {state.error ? (
            <div role="alert" className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-3 text-sm font-semibold text-[#d9362c] dark:text-red-300">
              {state.error}
            </div>
          ) : null}

          {state.message ? (
            <div role="status" className="rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 px-4 py-3 text-sm font-semibold text-[#1f7a5a] dark:text-emerald-300">
              {state.message}
            </div>
          ) : null}

          {state.message && (
            <p className="text-xs leading-5 text-muted-foreground">
              메일이 보이지 않으면 스팸함을 확인해주세요. 재발송한 경우 가장 최근 메일의 링크를 사용해주세요.
            </p>
          )}
          <SubmitButton retrySeconds={retrySeconds} />
        </form>

        <div className="mt-6 flex justify-center">
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href={`${localePrefix}/login`}
              className="inline-flex items-center rounded-[8px] border-2 border-border px-4 py-2 text-sm font-black text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
            >
              로그인
            </Link>
            <Link
              href={`${localePrefix}/track`}
              className="inline-flex items-center rounded-[8px] border-2 border-border px-4 py-2 text-sm font-black text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
            >
              비회원 조회
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
