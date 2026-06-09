"use client";

import { usePathname } from "next/navigation";

import { ChatbotWidget } from "@/components/chatbot-widget";
import { EnglishLanguagePack } from "@/components/i18n/english-language-pack";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPaymentPopupRoute = pathname.startsWith("/pay/inicis");
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");

  if (isPaymentPopupRoute) {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {isEnglishRoute ? <EnglishLanguagePack /> : null}
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <ChatbotWidget />
    </div>
  );
}
