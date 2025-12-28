import type { CSSProperties } from "react";

import { AboutRevealSection } from "@/components/about/about-reveal-section";

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
                ONSIDE PROFILE
              </p>
              <h1 className="font-display mt-3 text-3xl leading-tight text-[var(--about-ink)] md:text-4xl">
                온사이드
              </h1>
              <p className="mt-3 text-base leading-relaxed text-[var(--about-ink)]/80 md:text-lg">
                2017년부터 음반·뮤직비디오 심의 대행을 전문적으로 수행하며,
                아티스트와 기획사의 일정에 맞춘 빠르고 안정적인 심의 경험을
                제공합니다.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--about-ink)]/70">
                {[
                  "Album Review",
                  "MV Review",
                  "Online Delivery",
                  "Real-time Update",
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
                <img
                  src="/media/hero/onside-hero-poster.jpg"
                  alt="온사이드 심의 서비스 소개 이미지"
                  className="h-[220px] w-full object-cover md:h-[260px]"
                  loading="lazy"
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <img
                  src="/brand/onside-logo.svg"
                  alt="온사이드 로고"
                  className="h-6 w-auto"
                  loading="lazy"
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--about-ink)]/60">
                  End-to-end review support
                </p>
              </div>
            </div>
          </div>
        </section>

        <AboutRevealSection />
      </div>
    </div>
  );
}
