import type { CSSProperties } from "react";

import Image from "next/image";

import { AboutRevealSection } from "@/components/about/about-reveal-section";
import { SiteLogo } from "@/components/site/site-logo";

export const metadata = {
  title: "회사소개",
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div
        className="space-y-10"
        style={
          {
            "--about-ink": "var(--foreground)",
            "--about-surface": "var(--card)",
            "--about-surface-strong": "var(--muted)",
          } as CSSProperties
        }
      >
        <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-16 w-16 bg-[#f2cf27]" />
          <div aria-hidden="true" className="pointer-events-none absolute right-16 top-16 h-8 w-24 bg-[#1556a4]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-5 w-full bg-[#111111] dark:bg-[#f2cf27]" />
          <div className="relative z-10 grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <p className="bauhaus-kicker">
                Since 2017
              </p>
              <h1 className="font-display mt-4 text-2xl font-black leading-tight text-[var(--about-ink)] sm:text-3xl md:text-4xl">
                온사이드(onside)
              </h1>
              <p className="mt-3 text-base font-semibold leading-relaxed text-[var(--about-ink)]/80 md:text-lg">
                온사이드는 음반·뮤직비디오 심의를 온라인으로 간편하게 접수하고, 방송 가능 상태까지 빠르고 안전하게 진행할 수 있도록 도와줍니다.
                심의 진행 현황부터 승인 결과, 접수 기록까지 한 곳에서 관리하세요.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-normal text-[var(--about-ink)]/70">
                {[
                  "음반 심의",
                  "뮤비 심의",
                  "실시간 업데이트",
                ].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-[6px] border-2 border-[#111111] bg-white px-3 py-1"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="relative overflow-hidden rounded-[8px] border-2 border-[#111111] bg-white">
                <Image
                  src="/media/hero/glit-hero-poster.jpg"
                  alt="온사이드 심의 서비스 소개 이미지"
                  width={960}
                  height={520}
                  className="h-[220px] w-full object-cover md:h-[260px]"
                  priority={false}
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <SiteLogo
                  href={null}
                  width={96}
                  height={24}
                  className="h-6 w-auto"
                  showSrLabel={false}
                />
              </div>
            </div>
          </div>
        </section>

        <AboutRevealSection />
      </div>
    </div>
  );
}
