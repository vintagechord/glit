import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ChatbotWidget } from "@/components/chatbot-widget";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
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
      <body
        className={`${manrope.variable} ${spaceGrotesk.variable} min-h-screen font-sans antialiased`}
      >
        <ThemeProvider>
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <SiteHeader />

            {/* Left banner disabled: keep only center strip banner on pages that render it */}
            <main className="flex-1">{children}</main>

            <SiteFooter />
            <ChatbotWidget />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
