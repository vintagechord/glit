import type { CSSProperties } from "react";

import Image from "next/image";

import { AboutRevealSection } from "@/components/about/about-reveal-section";
import { SiteLogo } from "@/components/site/site-logo";

export const metadata = {
  title: "회사소개",
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div
        className="space-y-10"
        style={
          {
            "--about-ink": "#111111",
            "--about-surface": "#f6f6f6",
            "--about-surface-strong": "#ededed",
          } as CSSProperties
        }
      >
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,0.08)] md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.12),transparent_70%)] blur-2xl" />
          <div className="pointer-events-none absolute left-10 top-12 h-48 w-48 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.08),transparent_70%)] blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 right-10 h-52 w-52 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.06),transparent_70%)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-8 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.05),transparent_70%)] blur-3xl" />
          <div className="relative z-10 grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.5em] text-[var(--about-ink)]">
                Since 2017
              </p>
              <h1 className="font-display mt-3 text-3xl leading-tight text-[var(--about-ink)] md:text-4xl">
                온사이드(onside)
              </h1>
              <p className="mt-3 text-base leading-relaxed text-[var(--about-ink)]/80 md:text-lg">
                온사이드는 음반·뮤직비디오 심의를 온라인으로 연결해 “방송 가능”
                상태까지 빠르고 안전하게 만들어줍니다. 심의 진행, 승인, 기록
                아카이브를 한 곳에서 관리하세요.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--about-ink)]/70">
                {[
                  "음반 심의",
                  "뮤비 심의",
                  "실시간 업데이트",
                ].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-black/10 bg-white/80 px-3 py-1"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="relative overflow-hidden rounded-[28px] border border-border/60 bg-white/80">
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
