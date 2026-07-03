"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import * as React from "react";

import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

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
  const isAdminRoute = pathname.startsWith("/admin");
  const shouldLoadChatbot = !isPaymentPopupRoute && !isAdminRoute;

  React.useEffect(() => {
    if (!shouldLoadChatbot) {
      setLoadChatbot(false);
      return;
    }
    setLoadChatbot(false);

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
  }, [pathname, shouldLoadChatbot]);

  if (isPaymentPopupRoute) {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[8px] focus:border-2 focus:border-[#111111] focus:bg-[#f2cf27] focus:px-4 focus:py-2 focus:text-sm focus:font-black focus:text-[#111111] focus:shadow-[3px_3px_0_#111111]"
      >
        본문으로 바로가기
      </a>
      {isEnglishRoute ? <EnglishLanguagePack /> : null}
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      {loadChatbot ? <ChatbotWidget /> : null}
    </div>
  );
}
