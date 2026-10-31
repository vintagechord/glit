import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { NavigationLatencyLogger } from "@/components/perf/navigation-latency-logger";
import { AppShell } from "@/components/site/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { CenteredDialogHost } from "@/components/ui/centered-dialog-host";
import { OG_IMAGE, SEO_KEYWORDS, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/seo";
import { getBaseUrl } from "@/lib/url";

const enableNavigationLatencyLogger =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_NAV_PERF_DEBUG === "true";

// Search console ownership codes are configured per deployment (Vercel env),
// so registering Google, Naver or Bing needs no code change.
const verificationOther: Record<string, string> = {};
if (process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION) verificationOther["naver-site-verification"] = process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION;
if (process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION) verificationOther["msvalidate.01"] = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SEO_KEYWORDS,
  applicationName: SITE_NAME,
  category: "music",
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ko_KR",
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } : {}),
    ...(Object.keys(verificationOther).length ? { other: verificationOther } : {}),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased">
        <ThemeProvider>
          {enableNavigationLatencyLogger ? (
            <Suspense fallback={null}>
              <NavigationLatencyLogger />
            </Suspense>
          ) : null}
          <CenteredDialogHost />
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
