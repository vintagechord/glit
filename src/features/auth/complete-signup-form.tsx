"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { privacyContent, termsContent, refundContent, termsContentEn, privacyContentEn, refundContentEn } from "@/components/site/footer";
import { useModalFocus } from "@/lib/use-modal-focus";
import { completeSignupAction, type CompleteSignupState } from "./complete-signup-action";
import { getAuthReturnPath } from "./navigation";

type Policy = "terms" | "privacy" | "refund";
const initialState: CompleteSignupState = {};

export function CompleteSignupForm({ nextPath, english = false, consentAlreadySaved = false }: { nextPath?: string | null; english?: boolean; consentAlreadySaved?: boolean }) {
  const [state, formAction, pending] = useActionState(completeSignupAction, initialState);
  const [agreements, setAgreements] = useState({ age: false, terms: false, privacy: false, refund: false, marketing: false });
  const [activePolicy, setActivePolicy] = useState<Policy | null>(null);
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closePolicy = () => setActivePolicy(null);
  useModalFocus(Boolean(activePolicy), dialogRef, closePolicy);
  useEffect(() => {
    const form = formRef.current;
    // React resets action forms during commit even when the action returns an
    // error. Keep deliberate consent selections available for a safe retry.
    const preserveConsent = (event: Event) => event.preventDefault();
    form?.addEventListener("reset", preserveConsent);
    return () => form?.removeEventListener("reset", preserveConsent);
  }, []);
  const requiredAgreed = agreements.age && agreements.terms && agreements.privacy && agreements.refund;
  const policies = {
    terms: { title: english ? "Terms of Use" : "이용약관", content: english ? termsContentEn : termsContent },
    privacy: { title: english ? "Privacy Policy" : "개인정보 처리", content: english ? privacyContentEn : privacyContent },
    refund: { title: english ? "Payment and Refund Policy" : "결제·환불 정책", content: english ? refundContentEn : refundContent },
  };

  return (
    <>
      <form ref={formRef} action={formAction} className="space-y-5">
        <input type="hidden" name="next" value={getAuthReturnPath(nextPath, english) ?? ""} />
        <input type="hidden" name="locale" value={english ? "en" : "ko"} />
        {!consentAlreadySaved && <fieldset disabled={pending} className="space-y-3 rounded-[8px] border-2 border-border p-4">
          <legend className="px-1 text-sm font-black">{english ? "Required agreements" : "가입 동의"}</legend>
          <label className="flex min-h-11 items-center gap-3 border-b-2 border-border pb-3 text-sm font-black">
            <input type="checkbox" checked={requiredAgreed} onChange={(event) => setAgreements((current) => ({ ...current, age: event.target.checked, terms: event.target.checked, privacy: event.target.checked, refund: event.target.checked }))} className="h-5 w-5 shrink-0 accent-[#1556a4]" />
            {english ? "Accept all required agreements" : "필수 항목 전체 동의"}
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input name="agreeAge" type="checkbox" required checked={agreements.age} onChange={(event) => setAgreements((current) => ({ ...current, age: event.target.checked }))} className="h-4 w-4 shrink-0 accent-[#1556a4]" />
            {english ? "I am at least 14 years old (required)" : "만 14세 이상 (필수)"}
          </label>
          {(["terms", "privacy", "refund"] as const).map((policy) => (
            <div key={policy} className="flex min-h-11 items-center gap-3 text-sm">
              <label className="flex flex-1 items-center gap-3">
                <input name={`agree${policy[0].toUpperCase()}${policy.slice(1)}`} type="checkbox" required checked={agreements[policy]} onChange={(event) => setAgreements((current) => ({ ...current, [policy]: event.target.checked }))} className="h-4 w-4 shrink-0 accent-[#1556a4]" />
                <span>{policies[policy].title} {english ? "(required)" : "(필수)"}</span>
              </label>
              <button type="button" aria-label={english ? `View ${policies[policy].title}` : `${policies[policy].title} 보기`} onClick={() => setActivePolicy(policy)} className="min-h-11 shrink-0 rounded-[6px] border-2 border-border px-2 text-xs font-bold">{english ? "View" : "보기"}</button>
            </div>
          ))}
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input name="agreeMarketing" type="checkbox" checked={agreements.marketing} onChange={(event) => setAgreements((current) => ({ ...current, marketing: event.target.checked }))} className="h-4 w-4 shrink-0 accent-[#1556a4]" />
            {english ? "Receive news and offers (optional)" : "소식 받기 (선택)"}
          </label>
        </fieldset>}
        {state.error && <p role="alert" className="rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-4 py-3 text-sm font-semibold text-white">{state.error}</p>}
        <button type="submit" disabled={pending} className="bauhaus-button min-h-12 w-full px-5 py-3 text-sm disabled:cursor-wait">{pending ? (english ? "Completing signup..." : "가입 완료 중...") : consentAlreadySaved ? (english ? "Continue to Onside" : "온사이드 이용하기") : (english ? "Complete signup" : "가입 완료")}</button>
      </form>
      {activePolicy && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-4 py-6" onClick={closePolicy}>
          <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[calc(100dvh-3rem)] w-full max-w-3xl overflow-y-auto rounded-[10px] border-2 border-[#111111] bg-background p-5 text-foreground shadow-[6px_6px_0_#111111]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="text-xl font-black">{policies[activePolicy].title}</h2>
              <button type="button" onClick={closePolicy} className="min-h-11 shrink-0 rounded-[6px] border-2 border-border px-3 text-sm font-bold">{english ? "Close" : "닫기"}</button>
            </div>
            <pre className="mt-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{policies[activePolicy].content}</pre>
          </div>
        </div>
      )}
    </>
  );
}
