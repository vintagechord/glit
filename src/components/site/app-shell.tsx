"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import * as React from "react";

import {
  isEnglishPathname,
  loadedEnglishPack,
  loadEnglishPack,
} from "@/components/i18n/english-pack-loader";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

// An /en page opened directly starts fetching the language pack while the
// page scripts are still loading, rather than after hydration.
if (typeof window !== "undefined" && isEnglishPathname(window.location.pathname)) {
  loadEnglishPack().catch(() => {});
}

/**
 * Mounts the English pack on /en routes. Once the pack has loaded it renders
 * in the same commit as the route, so its layout effect translates the new
 * page before the browser paints it.
 */
function EnglishLanguageRuntime() {
  const [pack, setPack] = React.useState(loadedEnglishPack);

  React.useEffect(() => {
    if (pack) return;
    let live = true;
    loadEnglishPack()
      .then((loaded) => {
        if (live) setPack(loaded);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pack]);

  if (!pack) return null;
  const Pack = pack.EnglishLanguagePack;
  return <Pack />;
}

const ChatbotWidget = dynamic(
  () => import("@/components/chatbot-widget").then((mod) => mod.ChatbotWidget),
  { ssr: false },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loadChatbot, setLoadChatbot] = React.useState(false);
  const isPaymentPopupRoute = pathname.startsWith("/pay/inicis");
  const isEnglishRoute = isEnglishPathname(pathname);
  const basePath = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  const isArchiveResultRoute = /^\/mypage\/music\/results\/[0-9a-f-]+$/i.test(basePath);
  const isAdminRoute = basePath.startsWith("/admin");
  const isAuthRoute = ["/login", "/signup", "/complete-signup", "/confirm-email", "/forgot-password", "/reset-password"].includes(basePath);
  const isSubmissionFlow = /^\/(?:dashboard|mypage)\/(?:new|pay|cart)(?:\/|$)/.test(basePath) || basePath.startsWith("/apply");
  const shouldLoadChatbot = !isPaymentPopupRoute && !isArchiveResultRoute && !isAdminRoute && !isAuthRoute && !isSubmissionFlow;

  // The language switch turns the page English before the /en route arrives.
  // If another Korean page wins that navigation, put the Korean back.
  React.useLayoutEffect(() => {
    if (!isEnglishRoute) loadedEnglishPack()?.stopEnglish();
  }, [isEnglishRoute, pathname]);

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
    return <main className="min-h-dvh bg-background text-foreground">{isEnglishRoute ? <EnglishLanguageRuntime /> : null}{children}</main>;
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
      {isEnglishRoute ? <EnglishLanguageRuntime /> : null}
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      {shouldLoadChatbot && loadChatbot ? <ChatbotWidget /> : null}
    </div>
  );
}
