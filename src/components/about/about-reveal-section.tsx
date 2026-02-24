"use client";

import * as React from "react";

import { APP_CONFIG } from "@/lib/config";

const services = [
  "온라인으로 모든게 가능한 심의 절차",
  "최종 결과까지 개별 실시간 업데이트",
  "카드·모바일 등 온라인 결제",
  "CD/가사집/DVD 무료 제작",
  "전 방송사 접수 진행",
];

const revealBaseClass =
  "opacity-0 translate-y-6 transition-all duration-700 ease-out will-change-transform data-[reveal-state=visible]:opacity-100 data-[reveal-state=visible]:translate-y-0";

export function AboutRevealSection() {
  React.useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]")
    );
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-reveal-state", "visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <section className="grid gap-4 md:grid-cols-[1fr_1fr]">
      <div
        data-reveal
        data-reveal-state="hidden"
        className={`rounded-[28px] border border-black/20 bg-[linear-gradient(145deg,#ffffff_0%,#f3f3f3_100%)] p-6 text-neutral-900 shadow-[0_18px_36px_rgba(0,0,0,0.12)] ${revealBaseClass}`}
        style={{ transitionDelay: "80ms" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-900/70">
          핵심 서비스
        </p>
        <div className="mt-5 grid gap-3">
          {services.map((item, index) => {
            const tones = [
              "border-black/10 bg-white shadow-[0_10px_20px_rgba(0,0,0,0.08)]",
              "border-black/10 bg-[#f4f4f4] shadow-[0_8px_16px_rgba(0,0,0,0.07)]",
              "border-black/10 bg-white shadow-[0_10px_20px_rgba(0,0,0,0.08)]",
              "border-black/10 bg-[#f4f4f4] shadow-[0_8px_16px_rgba(0,0,0,0.07)]",
            ];
            return (
              <div
                key={item}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm text-neutral-900/80 ${tones[index % tones.length]}`}
              >
                <span className="text-xs font-semibold text-neutral-900/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4">
        <section
          data-reveal
          data-reveal-state="hidden"
          className={`flex min-h-[200px] items-center rounded-[28px] border border-black/70 bg-[linear-gradient(145deg,#0b0b0b_0%,#1f1f1f_100%)] p-6 text-white shadow-[0_20px_40px_rgba(0,0,0,0.35)] ${revealBaseClass}`}
          style={{ transitionDelay: "160ms" }}
        >
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
              정식 등록 업체
            </p>
            <div className="space-y-3 text-base leading-relaxed text-white/80">
              <p>통신판매업, 대중문화예술기획업, 음반·음악영상물제작업 등록 업체</p>
              <p>세금계산서·현금영수증·거래내역서 등 각종 증빙 서류 발급 가능</p>
              <div className="pt-1 space-y-1">
                <p className="font-semibold text-white/90">연관 업체 :</p>
                <p>음원 거래 플랫폼 워터멜론(Beat 마켓)</p>
                <p>음향기기 수리 서비스 마하픽스</p>
                <p>뮤직 스튜디오 V-House</p>
              </div>
            </div>
          </div>
        </section>

        <section
          data-reveal
          data-reveal-state="hidden"
          className={`flex min-h-[200px] items-center rounded-[28px] border border-black/20 bg-[linear-gradient(145deg,#ffffff_0%,#ededed_100%)] p-6 text-neutral-900 shadow-[0_18px_36px_rgba(0,0,0,0.12)] ${revealBaseClass}`}
          style={{ transitionDelay: "240ms" }}
        >
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-900/70">
              문의
            </p>
            <div className="space-y-2 text-base text-neutral-900/80">
              <p>
                전화: <span className="font-semibold">{APP_CONFIG.supportPhone}</span>
              </p>
              <p>
                이메일: <span className="font-semibold">{APP_CONFIG.supportEmail}</span>
              </p>
              <p className="text-sm text-neutral-900/70">
                운영시간: {APP_CONFIG.supportHours}
              </p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
