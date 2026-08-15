"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { privacyContent, termsContent } from "@/components/site/footer";

import { signupAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, initialState);
  const router = useRouter();
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const didRedirect = useRef(false);
  const [activeModal, setActiveModal] = useState<"terms" | "privacy" | null>(null);
  const [agreements, setAgreements] = useState({
    age: false,
    terms: false,
    privacy: false,
    refund: false,
    marketing: false,
  });
  const modalTitleId = useId();
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const agreeAgeRef = useRef<HTMLInputElement | null>(null);
  const agreeTermsRef = useRef<HTMLInputElement | null>(null);
  const agreePrivacyRef = useRef<HTMLInputElement | null>(null);
  const agreeRefundRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!state.message || didRedirect.current) return;
    didRedirect.current = true;
    const timer = window.setTimeout(() => {
      router.push(`${localePrefix}/login?signup=success`);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [localePrefix, state.message, router]);

  useEffect(() => {
    const order = [
      "email",
      "password",
      "confirmPassword",
      "agreeAge",
      "agreeTerms",
      "agreePrivacy",
      "agreeRefund",
    ];
    const firstErrorKey = order.find((key) => state.fieldErrors?.[key]);
    const refMap: Record<string, React.RefObject<HTMLInputElement | null>> = {
      email: emailRef,
      password: passwordRef,
      confirmPassword: confirmRef,
      agreeAge: agreeAgeRef,
      agreeTerms: agreeTermsRef,
      agreePrivacy: agreePrivacyRef,
      agreeRefund: agreeRefundRef,
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
  const currentModalTitleId = `${modalTitleId}-${activeModal ?? "closed"}`;
  const allRequiredAgreed =
    agreements.age &&
    agreements.terms &&
    agreements.privacy &&
    agreements.refund;

  useEffect(() => {
    if (!activeModal) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveModal(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeModal]);

  const SubmitButton = () => {
    const { pending } = useFormStatus();

    return (
      <button
        type="submit"
        className="bauhaus-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
      >
        {pending ? "가입 처리 중..." : "회원가입"}
      </button>
    );
  };

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="signup-email"
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
        >
          <span>이메일</span>
          <span className="text-rose-500">*</span>
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          ref={emailRef}
          className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
        />
        {state.fieldErrors?.email && (
          <p className="text-xs text-red-500">{state.fieldErrors.email}</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="signup-password"
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          >
            <span>비밀번호</span>
            <span className="text-rose-500">*</span>
          </label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            ref={passwordRef}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.password && (
            <p className="text-xs text-red-500">{state.fieldErrors.password}</p>
          )}
        </div>
        <div className="space-y-2">
          <label
            htmlFor="signup-confirm-password"
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          >
            <span>비밀번호 확인</span>
            <span className="text-rose-500">*</span>
          </label>
          <input
            id="signup-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            ref={confirmRef}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.confirmPassword && (
            <p className="text-xs text-red-500">{state.fieldErrors.confirmPassword}</p>
          )}
        </div>
      </div>

      <fieldset className="space-y-2 rounded-[8px] border-2 border-border bg-background/70 px-4 py-3 text-sm text-foreground">
        <legend className="sr-only">약관 동의</legend>
        <label className="flex cursor-pointer items-center gap-2 rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111]">
          <input
            type="checkbox"
            checked={allRequiredAgreed}
            onChange={(event) => {
              const checked = event.target.checked;
              setAgreements((current) => ({
                ...current,
                age: checked,
                terms: checked,
                privacy: checked,
                refund: checked,
              }));
            }}
            aria-controls="agreeAge agreeTerms agreePrivacy agreeRefund"
            className="h-4 w-4 rounded border-[#111111]"
          />
          필수 항목 전체 동의
        </label>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeAge"
            name="agreeAge"
            type="checkbox"
            required
            ref={agreeAgeRef}
            checked={agreements.age}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, age: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeAge" className="text-foreground">
            만 14세 이상
          </label>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeTerms"
            name="agreeTerms"
            type="checkbox"
            required
            ref={agreeTermsRef}
            checked={agreements.terms}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, terms: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeTerms" className="text-foreground">
            이용약관 <span className="text-muted-foreground">(필수)</span>
          </label>
          <button
            type="button"
            onClick={() => setActiveModal("terms")}
            className="ml-auto rounded-[6px] border border-border px-2 py-1 font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            보기
          </button>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreePrivacy"
            name="agreePrivacy"
            type="checkbox"
            required
            ref={agreePrivacyRef}
            checked={agreements.privacy}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, privacy: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreePrivacy" className="text-foreground">
            개인정보 처리 <span className="text-muted-foreground">(필수)</span>
          </label>
          <button
            type="button"
            onClick={() => setActiveModal("privacy")}
            className="ml-auto rounded-[6px] border border-border px-2 py-1 font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            보기
          </button>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeRefund"
            name="agreeRefund"
            type="checkbox"
            required
            ref={agreeRefundRef}
            checked={agreements.refund}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, refund: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeRefund" className="text-foreground">
            결제·환불 정책 <span className="text-muted-foreground">(필수)</span>
          </label>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeMarketing"
            name="agreeMarketing"
            type="checkbox"
            checked={agreements.marketing}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, marketing: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeMarketing" className="text-foreground">
            소식 받기 <span className="text-muted-foreground">(선택)</span>
          </label>
        </div>
        {(state.fieldErrors?.agreeAge ||
          state.fieldErrors?.agreeTerms ||
          state.fieldErrors?.agreePrivacy ||
          state.fieldErrors?.agreeRefund) && (
          <p className="text-xs text-red-500">
            필수 약관과 정책에 동의해야 가입이 가능합니다.
          </p>
        )}
      </fieldset>
      {state.error && (
        <p className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-2 text-xs font-semibold text-[#d9362c]">
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          aria-live="polite"
          className="rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 px-4 py-2 text-xs font-semibold text-[#1f7a5a]"
        >
          {state.message} 로그인 페이지로 이동합니다.
        </p>
      )}
      <SubmitButton />
      <p className="text-center text-xs text-muted-foreground">
        이미 계정이 있나요?{" "}
        <Link
          href={`${localePrefix}/login`}
          className="font-semibold text-foreground"
        >
          로그인
        </Link>
      </p>
      {activeModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={currentModalTitleId}
            className="max-h-[calc(100dvh-3rem)] w-full max-w-3xl overflow-y-auto rounded-[10px] border-2 border-[#111111] bg-background px-5 py-5 text-sm text-foreground shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] sm:px-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  {activeModal === "terms" ? "Terms" : "Privacy"}
                </p>
                <h2 id={currentModalTitleId} className="mt-2 text-xl font-semibold">
                  {activeModal === "terms" ? "이용약관" : "개인정보처리방침"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[8px] border-2 border-border px-3 py-1 text-xs font-black text-foreground transition hover:bg-foreground hover:text-background"
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
