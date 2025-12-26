import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

import { ChatbotWidget } from "@/components/chatbot-widget";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { LeftAdBanner } from "@/components/site/left-ad-banner";
import { ThemeProvider } from "@/components/theme-provider";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Onside",
    template: "%s | Onside",
  },
  description: "음원 및 뮤직비디오 심의 접수 · 진행 · 결과 통보 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`${manrope.variable} ${spaceGrotesk.variable} min-h-screen font-sans antialiased`}
      >
        <ThemeProvider>
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <SiteHeader />
            <LeftAdBanner />
            <main className="flex-1">{children}</main>
            <SiteFooter />
            <ChatbotWidget />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
