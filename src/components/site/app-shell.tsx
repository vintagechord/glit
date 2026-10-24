"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import * as React from "react";

import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { ReliableLink } from "@/components/site/reliable-link";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";

const EnglishLanguagePack = dynamic(
  () =>
    import("@/components/i18n/english-language-pack").then(
      (mod) => mod.EnglishLanguagePack,
    ),
  { ssr: false },
);

const ChatbotWidget = dynamic(
  () => import("@/components/chatbot-widget").then((mod) => mod.ChatbotWidget),
  { ssr: false },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loadChatbot, setLoadChatbot] = React.useState(false);
  const isPaymentPopupRoute = pathname.startsWith("/pay/inicis");
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const basePath = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  const isArchiveResultRoute = /^\/mypage\/music\/results\/[0-9a-f-]+$/i.test(basePath);
  const isAdminRoute = basePath.startsWith("/admin");
  const isAuthRoute = ["/login", "/signup", "/forgot-password", "/reset-password"].includes(basePath);
  const isSubmissionFlow = /^\/(?:dashboard|mypage)\/(?:new|pay|cart)(?:\/|$)/.test(basePath) || basePath.startsWith("/apply");
  const shouldLoadChatbot = !isPaymentPopupRoute && !isArchiveResultRoute && !isAdminRoute && !isAuthRoute && !isSubmissionFlow;

  React.useEffect(() => {
    if (!shouldLoadChatbot || loadChatbot) return;

    const scheduleIdle =
      typeof window !== "undefined" &&
      "requestIdleCallback" in window &&
      typeof window.requestIdleCallback === "function";
    let idleId: number | null = null;
    let timeoutId: number | null = null;

    if (scheduleIdle) {
      idleId = window.requestIdleCallback(() => setLoadChatbot(true), {
        timeout: 4200,
      });
    } else {
      timeoutId = window.setTimeout(() => setLoadChatbot(true), 2600);
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [loadChatbot, shouldLoadChatbot]);

  if (isArchiveResultRoute) {
    return <main className="min-h-dvh bg-background text-foreground">{isEnglishRoute ? <EnglishLanguagePack /> : null}{children}</main>;
  }

  if (isPaymentPopupRoute) {
    return (
      <div className="min-h-dvh bg-white text-slate-900">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[8px] focus:border-2 focus:border-[#111111] focus:bg-[#f2cf27] focus:px-4 focus:py-2 focus:text-sm focus:font-black focus:text-[#111111] focus:shadow-[3px_3px_0_#111111]"
      >
        본문으로 바로가기
      </a>
      {isEnglishRoute ? <EnglishLanguagePack /> : null}
      <SiteHeader />
      {getEmailDeliveryMode() === "manual" ? (
        <aside aria-label={isEnglishRoute ? "Email Delivery Notice" : "이메일 발송 안내"} className="border-b border-border bg-[#f2cf27]/15 px-4 py-3 text-sm leading-6 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
            <p>{isEnglishRoute
              ? "Automated email is being prepared. Check progress and results on the site, and keep your guest lookup code."
              : "이메일 자동 발송을 준비 중입니다. 진행·결과는 사이트에서 직접 조회하고, 비회원 조회 코드를 보관해주세요."}</p>
            <ReliableLink href={isEnglishRoute ? "/en/track" : "/track"} className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">
              {isEnglishRoute ? "View Progress and Results" : "진행·결과 직접 조회"}
            </ReliableLink>
          </div>
        </aside>
      ) : null}
      <main id="main-content" className="flex-1">
        {children}
      </main>
      {isSubmissionFlow ? (
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm sm:px-6">
          <ReliableLink href="/support" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">
            신청·결제 도움말 및 문의 (새 창)
          </ReliableLink>
        </div>
      ) : null}
      <SiteFooter />
      {shouldLoadChatbot && loadChatbot ? <ChatbotWidget /> : null}
    </div>
  );
}
