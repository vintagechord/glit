"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { signupAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, initialState);
  const router = useRouter();
  const didRedirect = useRef(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    if (!state.message || didRedirect.current) return;
    didRedirect.current = true;
    if (typeof window !== "undefined") {
      window.alert(state.message);
    }
    router.push("/login");
  }, [state.message, router]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            이름 (선택)
          </label>
          <input
            name="name"
            type="text"
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
          {state.fieldErrors?.name && (
            <p className="text-xs text-red-500">{state.fieldErrors.name}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            연락처 (선택)
          </label>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
          {state.fieldErrors?.phone && (
            <p className="text-xs text-red-500">{state.fieldErrors.phone}</p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          회사/기획사 (선택)
        </label>
        <input
          name="company"
          type="text"
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
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
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          비밀번호 확인
        </label>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {state.fieldErrors?.confirmPassword && (
          <p className="text-xs text-red-500">{state.fieldErrors.confirmPassword}</p>
        )}
      </div>
      <div className="space-y-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          약관 동의
        </p>
        <div className="space-y-2 text-xs">
          <details
            open={showTerms}
            onToggle={(e) => setShowTerms(e.currentTarget.open)}
            className="rounded-xl border border-border/60 bg-background/70 px-3 py-2"
          >
            <summary className="cursor-pointer text-foreground">이용약관 보기</summary>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              GLIT 서비스 이용과 관련된 기본 약관입니다. 심의 진행, 결제, 환불, 자료 보관에
              관한 내용을 포함합니다.
            </p>
          </details>
          <details
            open={showPrivacy}
            onToggle={(e) => setShowPrivacy(e.currentTarget.open)}
            className="rounded-xl border border-border/60 bg-background/70 px-3 py-2"
          >
            <summary className="cursor-pointer text-foreground">개인정보처리방침 보기</summary>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              수집·이용 목적, 보유 기간, 제3자 제공 및 위탁 사항, 동의 철회 방법을
              안내합니다. 서비스 제공을 위한 최소 정보만 사용합니다.
            </p>
          </details>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input
            id="agreeTerms"
            name="agreeTerms"
            type="checkbox"
            required
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeTerms" className="text-foreground">
            이용약관에 동의합니다.
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input
            id="agreePrivacy"
            name="agreePrivacy"
            type="checkbox"
            required
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreePrivacy" className="text-foreground">
            개인정보처리방침에 동의합니다.
          </label>
        </div>
        {(state.fieldErrors?.agreeTerms || state.fieldErrors?.agreePrivacy) && (
          <p className="text-xs text-red-500">
            약관과 개인정보 처리방침에 동의해야 가입이 가능합니다.
          </p>
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
