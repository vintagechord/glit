"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { privacyContent, termsContent, refundContent, termsContentEn, privacyContentEn, refundContentEn } from "@/components/site/footer";
import { useModalFocus } from "@/lib/use-modal-focus";
import { getAuthPageHref, getAuthReturnPath } from "./navigation";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "./policy";
import { PasswordInput } from "./password-input";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";

import { signupAction, type ActionState } from "./actions";
import { useAuthNotice } from "./use-auth-notice";

const initialState: ActionState = {};

export function SignupForm({ nextPath }: { nextPath?: string | null }) {
  const [state, formAction] = useActionState(signupAction, initialState);
  const router = useRouter();
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const english = Boolean(localePrefix);
  useAuthNotice(state, english);
  const needsVerification = getEmailDeliveryMode() !== "manual";
  const effectiveNextPath = getAuthReturnPath(nextPath, english);
  const loginHref = getAuthPageHref("login", effectiveNextPath, english);
  const successHref = getAuthPageHref("login", effectiveNextPath, english, true);
  const didRedirect = useRef(false);
  const [activeModal, setActiveModal] = useState<"terms" | "privacy" | "refund" | null>(null);
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
    if (!state.message || state.verificationPending || didRedirect.current) return;
    didRedirect.current = true;
    const timer = window.setTimeout(() => {
      router.push(successHref);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [successHref, state.message, state.verificationPending, router]);

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

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(Boolean(activeModal), dialogRef, closeModal);
  const modalTitle = activeModal === "terms"
    ? (english ? "Terms of Use" : "이용약관")
    : activeModal === "privacy"
      ? (english ? "Privacy Policy" : "개인정보처리방침")
      : (english ? "Refund / Cancellation Policy" : "결제·환불 정책");
  const modalContent = activeModal === "terms"
    ? (english ? termsContentEn : termsContent)
    : activeModal === "privacy"
      ? (english ? privacyContentEn : privacyContent)
      : (english ? refundContentEn : refundContent);

  const SubmitButton = () => {
    const { pending } = useFormStatus();

    return (
      <button
        type="submit"
        className="bauhaus-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
      >
        {pending ? (english ? "Creating account..." : "가입 처리 중...") : (english ? "Sign up" : "회원가입")}
      </button>
    );
  };

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={effectiveNextPath ?? ""} />
      <input type="hidden" name="locale" value={english ? "en" : "ko"} />
      <div className="space-y-2">
        <label
          htmlFor="signup-email"
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
        >
          <span>{english ? "Email" : "이메일"}</span>
          <span aria-hidden="true" className="text-rose-500">*</span>
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby="signup-email-note signup-email-error"
          ref={emailRef}
          className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
        />
        <p id="signup-email-note" className="text-xs leading-5 text-muted-foreground">
          {needsVerification
            ? english ? "We will email a verification link. Set your password after verifying your email." : "인증 링크를 이메일로 보내드립니다. 이메일 확인 후 비밀번호를 설정하면 가입이 완료됩니다."
            : english ? "Signup does not verify email ownership. Enter an email address where you can receive updates." : "가입 시 별도 이메일 소유 확인을 진행하지 않습니다. 안내를 받을 수 있는 이메일을 입력해주세요."}
        </p>
        {state.fieldErrors?.email && (
          <p id="signup-email-error" className="text-xs text-red-500">{state.fieldErrors.email}</p>
        )}
      </div>
      {!needsVerification && <><div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="signup-password"
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          >
            <span>{english ? "Password" : "비밀번호"}</span>
            <span aria-hidden="true" className="text-rose-500">*</span>
          </label>
          <PasswordInput
            label={english ? "Password" : "비밀번호"}
            english={english}
            id="signup-password"
            name="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby="signup-password-help signup-password-error"
            required
            ref={passwordRef}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.password && (
            <p id="signup-password-error" className="text-xs text-red-500">{state.fieldErrors.password}</p>
          )}
        </div>
        <div className="space-y-2">
          <label
            htmlFor="signup-confirm-password"
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          >
            <span>{english ? "Confirm password" : "비밀번호 확인"}</span>
            <span aria-hidden="true" className="text-rose-500">*</span>
          </label>
          <PasswordInput
            label={english ? "Confirm password" : "비밀번호 확인"}
            english={english}
            id="signup-confirm-password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
            aria-describedby="signup-password-help signup-confirm-password-error"
            required
            ref={confirmRef}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          {state.fieldErrors?.confirmPassword && (
            <p id="signup-confirm-password-error" className="text-xs text-red-500">{state.fieldErrors.confirmPassword}</p>
          )}
        </div>
      </div>

      <p id="signup-password-help" className="text-xs text-muted-foreground">
        {english ? `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.` : `비밀번호는 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH}자로 입력해주세요.`}
      </p></>}
      <fieldset className="space-y-2 rounded-[8px] border-2 border-border bg-background/70 px-4 py-3 text-sm text-foreground">
        <legend className="sr-only">{english ? "Agreements" : "약관 동의"}</legend>
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
          {english ? "Accept all required items" : "필수 항목 전체 동의"}
        </label>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeAge"
            name="agreeAge"
            type="checkbox"
            required
            ref={agreeAgeRef}
            aria-invalid={Boolean(state.fieldErrors?.agreeAge)}
            aria-describedby={state.fieldErrors?.agreeAge ? "signup-agreements-error" : undefined}
            checked={agreements.age}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, age: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeAge" className="text-foreground">
            {english ? "I am at least 14 years old" : "만 14세 이상"}
          </label>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeTerms"
            name="agreeTerms"
            type="checkbox"
            required
            ref={agreeTermsRef}
            aria-invalid={Boolean(state.fieldErrors?.agreeTerms)}
            aria-describedby={state.fieldErrors?.agreeTerms ? "signup-agreements-error" : undefined}
            checked={agreements.terms}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, terms: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeTerms" className="text-foreground">
            {english ? "Terms of Use" : "이용약관"} <span className="text-muted-foreground">{english ? "(required)" : "(필수)"}</span>
          </label>
          <button
            type="button"
            aria-label={english ? "View terms of use" : "이용약관 보기"}
            onClick={() => setActiveModal("terms")}
            className="ml-auto rounded-[6px] border border-border px-2 py-1 font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            {english ? "View" : "보기"}
          </button>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreePrivacy"
            name="agreePrivacy"
            type="checkbox"
            required
            ref={agreePrivacyRef}
            aria-invalid={Boolean(state.fieldErrors?.agreePrivacy)}
            aria-describedby={state.fieldErrors?.agreePrivacy ? "signup-agreements-error" : undefined}
            checked={agreements.privacy}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, privacy: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreePrivacy" className="text-foreground">
            {english ? "Privacy Policy" : "개인정보 처리"} <span className="text-muted-foreground">{english ? "(required)" : "(필수)"}</span>
          </label>
          <button
            type="button"
            aria-label={english ? "View privacy policy" : "개인정보 처리 보기"}
            onClick={() => setActiveModal("privacy")}
            className="ml-auto rounded-[6px] border border-border px-2 py-1 font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            {english ? "View" : "보기"}
          </button>
        </div>
        <div className="flex min-h-9 items-center gap-2 text-xs">
          <input
            id="agreeRefund"
            name="agreeRefund"
            type="checkbox"
            required
            ref={agreeRefundRef}
            aria-invalid={Boolean(state.fieldErrors?.agreeRefund)}
            aria-describedby={state.fieldErrors?.agreeRefund ? "signup-agreements-error" : undefined}
            checked={agreements.refund}
            onChange={(event) =>
              setAgreements((current) => ({ ...current, refund: event.target.checked }))
            }
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="agreeRefund" className="text-foreground">
            {english ? "Payment and Refund Policy" : "결제·환불 정책"} <span className="text-muted-foreground">{english ? "(required)" : "(필수)"}</span>
          </label>
          <button
            type="button"
            aria-label={english ? "View refund policy" : "결제·환불 정책 보기"}
            onClick={() => setActiveModal("refund")}
            className="ml-auto rounded-[6px] border border-border px-2 py-1 font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            {english ? "View" : "보기"}
          </button>
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
            {english ? "Receive news and offers" : "소식 받기"} <span className="text-muted-foreground">{english ? "(optional)" : "(선택)"}</span>
          </label>
        </div>
        {(state.fieldErrors?.agreeAge ||
          state.fieldErrors?.agreeTerms ||
          state.fieldErrors?.agreePrivacy ||
          state.fieldErrors?.agreeRefund) && (
          <p id="signup-agreements-error" className="text-xs text-red-500">
            {english ? "You must agree to the required terms and policies to sign up." : "필수 약관과 정책에 동의해야 가입이 가능합니다."}
          </p>
        )}
      </fieldset>
      {state.error && (
        <p role="alert" className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-2 text-xs font-semibold text-[#d9362c]">
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          aria-live="polite"
          className="rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 px-4 py-2 text-xs font-semibold text-[#1f7a5a]"
        >
          {state.message}{!state.verificationPending ? (english ? " You will be taken to the login page." : " 로그인 페이지로 이동합니다.") : ""}
        </p>
      )}
      {state.verificationPending && <Link href={getAuthPageHref("confirm-email", effectiveNextPath, english)} className="block text-sm font-semibold underline underline-offset-4">{english ? "Resend verification email" : "인증 메일 다시 받기"}</Link>}
      {state.notice === "email_already_registered" && !state.verificationPending && (
        <p className="flex flex-wrap gap-4 text-sm font-semibold underline underline-offset-4">
          <Link href={loginHref}>{english ? "Log in" : "로그인"}</Link>
          <Link href={getAuthPageHref("forgot-password", effectiveNextPath, english)}>{english ? "Reset password" : "비밀번호 찾기"}</Link>
        </p>
      )}
      <SubmitButton />
      <p className="text-center text-xs text-muted-foreground">
        {english ? "Already have an account?" : "이미 계정이 있나요?"}{" "}
        <Link
          href={loginHref}
          className="font-semibold text-foreground"
        >
          {english ? "Log in" : "로그인"}
        </Link>
      </p>
      {activeModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={currentModalTitleId}
            className="max-h-[calc(100dvh-3rem)] w-full max-w-3xl overflow-y-auto rounded-[10px] border-2 border-[#111111] bg-background px-5 py-5 text-sm text-foreground shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] sm:px-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  {activeModal === "terms" ? "Terms" : activeModal === "privacy" ? "Privacy" : "Refund"}
                </p>
                <h2 id={currentModalTitleId} className="mt-2 text-xl font-semibold">
                  {modalTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[8px] border-2 border-border px-3 py-1 text-xs font-black text-foreground transition hover:bg-foreground hover:text-background"
              >
                {english ? "Close" : "닫기"}
              </button>
            </div>
            <pre className="mt-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {modalContent}
            </pre>
          </div>
        </div>
      )}
    </form>
  );
}
