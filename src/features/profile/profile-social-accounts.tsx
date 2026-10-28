"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SocialAuthNotice } from "@/features/auth/social-auth-buttons";
import { socialProviders, type SocialAvailability, type SocialProviderId } from "@/features/auth/social-contract";
import { SocialProviderMark, socialProviderStyles } from "@/features/auth/social-provider-mark";

function ProfileSocialNotice({ english }: { english: boolean }) {
  const query = useSearchParams();
  return <SocialAuthNotice errorCode={query.get("social_error")} linked={query.get("social_link") === "success"} english={english} />;
}

export type ProfileSocialAccountsProps = {
  availability: SocialAvailability;
  linkedProviders: SocialProviderId[];
  english?: boolean;
  loading?: boolean;
};

export function ProfileSocialAccounts({ availability, linkedProviders, english = false, loading = false }: ProfileSocialAccountsProps) {
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null);
  return (
    <div className="mt-5 space-y-4 border-t-2 border-border pt-5">
      <h3 className="text-sm font-black">{english ? "Linked social accounts" : "소셜 계정 연결"}</h3>
      <p className="text-xs leading-5 text-muted-foreground">{english ? "Link a social account here to use it with your current Onside account." : "현재 온사이드 계정으로 소셜 로그인을 이용하려면 여기서 연결해주세요."}</p>
      <Suspense fallback={null}><ProfileSocialNotice english={english} /></Suspense>
      <div className="space-y-3">
        {socialProviders.map(({ id, label }) => {
          const name = english ? ({ google: "Google", naver: "Naver", kakao: "Kakao" } as const)[id] : label;
          if (linkedProviders.includes(id)) return (
            <div key={id} className={`flex min-h-12 items-center justify-between gap-3 rounded-[8px] border-2 border-[#111111] px-3 py-2 text-sm font-bold ${socialProviderStyles[id]}`}><span className="inline-flex items-center gap-2"><SocialProviderMark provider={id} />{name}</span><span className="text-xs">{english ? "Linked" : "연결됨"}</span></div>
          );
          return (
            <form key={id} method="post" action={`/auth/link/${id}`} onSubmit={() => setPendingProvider(id)}>
              <input type="hidden" name="locale" value={english ? "en" : "ko"} />
              <input type="hidden" name="next" value={`${english ? "/en" : ""}/mypage/profile`} />
              <button type="submit" disabled={!availability[id] || Boolean(pendingProvider)} className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border-2 border-[#111111] px-3 py-2 text-left text-sm font-bold disabled:cursor-not-allowed ${socialProviderStyles[id]}`}>
                <span className="inline-flex items-center gap-2"><SocialProviderMark provider={id} />{name}</span><span className="text-xs">{loading ? (english ? "Checking..." : "확인 중...") : !availability[id] ? (english ? "Setup pending" : "준비 중") : pendingProvider === id ? (english ? "Connecting..." : "연결 중...") : (english ? "Link account" : "연결하기")}</span>
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
