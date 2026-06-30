import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { NavigationLatencyLogger } from "@/components/perf/navigation-latency-logger";
import { AppShell } from "@/components/site/app-shell";
import { ThemeProvider } from "@/components/theme-provider";

const enableNavigationLatencyLogger =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_NAV_PERF_DEBUG === "true";

export const metadata: Metadata = {
  title: {
    default: "온사이드",
    template: "%s | 온사이드",
  },
  description:
    "온사이드 — 음반·뮤직비디오 심의부터 방송 가능까지 한 번에. 접수, 승인, 아카이브를 온라인으로 관리하세요.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          {enableNavigationLatencyLogger ? (
            <Suspense fallback={null}>
              <NavigationLatencyLogger />
            </Suspense>
          ) : null}
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
