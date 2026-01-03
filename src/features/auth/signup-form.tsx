"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { privacyContent, termsContent } from "@/components/site/footer";

import { signupAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, initialState);
  const router = useRouter();
  const didRedirect = useRef(false);
  const [activeModal, setActiveModal] = useState<"terms" | "privacy" | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const companyRef = useRef<HTMLInputElement | null>(null);
  const agreeTermsRef = useRef<HTMLInputElement | null>(null);
  const agreePrivacyRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!state.message || didRedirect.current) return;
    didRedirect.current = true;
    if (typeof window !== "undefined") {
      window.alert(state.message);
    }
    router.push("/login");
  }, [state.message, router]);

  useEffect(() => {
    const order = [
      "email",
      "password",
      "confirmPassword",
      "agreeTerms",
      "agreePrivacy",
      "name",
      "phone",
      "company",
    ];
    const firstErrorKey = order.find((key) => state.fieldErrors?.[key]);
    const refMap: Record<string, React.RefObject<HTMLInputElement | null>> = {
      email: emailRef,
      password: passwordRef,
      confirmPassword: confirmRef,
      name: nameRef,
      phone: phoneRef,
      company: companyRef,
      agreeTerms: agreeTermsRef,
      agreePrivacy: agreePrivacyRef,
    };
    if (firstErrorKey) {
      const target = refMap[firstErrorKey]?.current;
      if (target) {
        target.focus();
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [state.fieldErrors]);

  const closeModal = () => setActiveModal(null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <span>이메일</span>
          <span className="text-rose-500">*</span>
        </label>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          ref={emailRef}
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {state.fieldErrors?.email && (
          <p className="text-xs text-red-500">{state.fieldErrors.email}</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span>비밀번호</span>
            <span className="text-rose-500">*</span>
          </label>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            ref={passwordRef}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
          {state.fieldErrors?.password && (
            <p className="text-xs text-red-500">{state.fieldErrors.password}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span>비밀번호 확인</span>
            <span className="text-rose-500">*</span>
          </label>
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            ref={confirmRef}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
          {state.fieldErrors?.confirmPassword && (
            <p className="text-xs text-red-500">{state.fieldErrors.confirmPassword}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            이름 (선택)
          </label>
          <input
            name="name"
            type="text"
            ref={nameRef}
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
            ref={phoneRef}
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
          ref={companyRef}
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
      </div>

      <div className="space-y-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            약관 동의
          </p>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setActiveModal("terms")}
              className="rounded-full border border-border/70 px-3 py-1 text-foreground transition hover:bg-foreground hover:text-background"
            >
              이용약관 보기
            </button>
            <button
              type="button"
              onClick={() => setActiveModal("privacy")}
              className="rounded-full border border-border/70 px-3 py-1 text-foreground transition hover:bg-foreground hover:text-background"
            >
              개인정보처리방침 보기
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input
            id="agreeTerms"
            name="agreeTerms"
            type="checkbox"
            required
            ref={agreeTermsRef}
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
            ref={agreePrivacyRef}
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
      {activeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={closeModal}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-border/70 bg-background px-6 py-5 text-sm text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  {activeModal === "terms" ? "Terms" : "Privacy"}
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {activeModal === "terms" ? "이용약관" : "개인정보처리방침"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold text-foreground transition hover:bg-foreground hover:text-background"
              >
                닫기
              </button>
            </div>
            <pre className="mt-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {activeModal === "terms" ? termsContent : privacyContent}
            </pre>
          </div>
        </div>
      )}
    </form>
  );
}
