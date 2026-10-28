"use client";

import { usePathname } from "next/navigation";
import { useId } from "react";

import { getAuthReturnPath } from "./navigation";
import { socialProviders, type SocialAvailability } from "./social-contract";
import { SocialProviderMark, socialProviderStyles } from "./social-provider-mark";

const errors: Record<string, [string, string]> = {
  cancelled: ["소셜 로그인이 취소되었습니다. 다시 시도해주세요.", "Social sign-in was cancelled. Please try again."],
  expired: ["로그인 요청이 만료되었습니다. 다시 시작해주세요.", "Your sign-in request expired. Please start again."],
  unavailable: ["이 로그인 방식은 현재 준비 중입니다. 다른 방법을 이용해주세요.", "This sign-in method is being set up. Please use another method."],
  failed: ["소셜 로그인에 실패했습니다. 다시 시도해주세요.", "Social sign-in failed. Please try again."],
  profile: ["소셜 계정 정보를 확인하지 못했습니다. 다시 시도해주세요.", "We could not verify your social account. Please try again."],
  "link-unavailable": ["계정 연결을 현재 이용할 수 없습니다.", "Account linking is currently unavailable."],
  "link-failed": ["계정을 연결하지 못했습니다. 다시 시도해주세요.", "Could not link the account. Please try again."],
  "link-expired": ["계정 연결 요청이 만료되었습니다. 다시 시작해주세요.", "Your linking request expired. Please start again."],
  "link-conflict": ["이미 다른 온사이드 계정에 연결된 소셜 계정입니다.", "This social account is already linked to another Onside account."],
};

export function SocialAuthNotice({ errorCode, linked, english = false }: {
  errorCode?: string | null;
  linked?: boolean;
  english?: boolean;
}) {
  const message = errorCode ? errors[errorCode]?.[english ? 1 : 0] : undefined;
  if (message) return <p role="alert" className="rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-4 py-3 text-sm font-semibold text-white">{message}</p>;
  if (linked) return <p role="status" className="rounded-[8px] border-2 border-[#111111] bg-[#1f7a5a] px-4 py-3 text-sm font-semibold text-white">{english ? "Social account linked." : "소셜 계정이 연결되었습니다."}</p>;
  return null;
}

export function NaverReviewNotice({ id, english = false }: { id: string; english?: boolean }) {
  return (
    <p id={id} className="rounded-[8px] border-2 border-[#111111] bg-[#f2d524] px-3 py-2 text-xs leading-5 text-[#111111]">
      <strong className="font-black">{english ? "Under review" : "검수 중"}</strong>{" "}
      {english
        ? "Until Naver approves this app, only app administrators and registered testers can use Naver sign-in."
        : "네이버 로그인은 검수 완료 전까지 네이버 앱 관리자와 등록된 테스터만 이용할 수 있습니다."}
    </p>
  );
}

export type SocialAuthButtonsProps = {
  availability: SocialAvailability;
  nextPath?: string | null;
  mode?: "login" | "signup";
  errorCode?: string | null;
  loading?: boolean;
  naverReviewPending?: boolean;
};

export function SocialAuthButtons({ availability, nextPath, mode = "login", errorCode, loading = false, naverReviewPending = false }: SocialAuthButtonsProps) {
  const pathname = usePathname();
  const naverReviewNoticeId = useId();
  const english = pathname === "/en" || pathname.startsWith("/en/");
  const next = getAuthReturnPath(nextPath, english);
  const query = new URLSearchParams({ locale: english ? "en" : "ko" });
  if (next) query.set("next", next);
  return (
    <div className="space-y-4">
      <SocialAuthNotice errorCode={errorCode} english={english} />
      <div className="grid gap-3" aria-label={english ? "Social sign-in" : "소셜 로그인"}>
        {socialProviders.map(({ id, label }) => {
          const providerName = english ? ({ google: "Google", naver: "Naver", kakao: "Kakao" } as const)[id] : label;
          const text = english ? `Continue with ${providerName}` : `${providerName}로 ${mode === "signup" ? "시작하기" : "로그인"}`;
          const className = `flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] px-4 py-3 text-center text-sm font-black shadow-[3px_3px_0_#111111] ${socialProviderStyles[id]}`;
          const showReviewNotice = id === "naver" && availability.naver && naverReviewPending;
          return (
            <div key={id} className="space-y-2">
              {availability[id] ? (
                // Native links deliberately avoid framework prefetch and preserve PKCE cookie redirects.
                <a href={`/auth/social/${id}?${query}`} aria-describedby={showReviewNotice ? naverReviewNoticeId : undefined} className={`${className} transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground`}><SocialProviderMark provider={id} /><span>{text}</span></a>
              ) : (
                <button type="button" disabled className={`${className} cursor-not-allowed`}>
                  <SocialProviderMark provider={id} /><span>{text}</span><span className="rounded border border-current px-1.5 py-0.5 text-[10px]">{loading ? (english ? "Checking..." : "확인 중...") : (english ? "Setup pending" : "준비 중")}</span>
                </button>
              )}
              {showReviewNotice && <NaverReviewNotice id={naverReviewNoticeId} english={english} />}
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs leading-5 text-muted-foreground">{english ? "New here? Review the required agreements after social sign-in." : "처음 이용하시는 경우 소셜 로그인 후 필수 약관에 동의하면 가입이 완료됩니다."}</p>
      <div className="flex items-center gap-3 text-xs font-semibold text-muted-foreground"><span className="h-px flex-1 bg-border" />{english ? "or use email" : "또는 이메일로 이용"}<span className="h-px flex-1 bg-border" /></div>
    </div>
  );
}
