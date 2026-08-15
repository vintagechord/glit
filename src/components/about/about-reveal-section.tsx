"use client";

import * as React from "react";
import {
  Building2,
  CreditCard,
  Disc3,
  FileCheck2,
  Mail,
  Phone,
  Radio,
} from "lucide-react";

import { APP_CONFIG } from "@/lib/config";

const services = [
  { label: "온라인 접수", detail: "음반 · MV", icon: FileCheck2 },
  { label: "실시간 현황", detail: "접수부터 결과까지", icon: Radio },
  { label: "온라인 결제", detail: "카드 · 모바일", icon: CreditCard },
  { label: "제작 지원", detail: "CD · 가사집 · DVD", icon: Disc3 },
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
        className={`rounded-[10px] border-2 border-[#111111] bg-card p-6 text-foreground shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] ${revealBaseClass}`}
        style={{ transitionDelay: "80ms" }}
      >
        <p className="bauhaus-kicker">
          핵심 서비스
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {services.map((item, index) => {
            const tones = [
              "border-[#111111] bg-white dark:bg-[#171717]",
              "border-[#111111] bg-[#f2cf27] text-[#111111]",
              "border-[#111111] bg-white dark:bg-[#171717]",
              "border-[#111111] bg-[#1556a4] text-white",
            ];
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className={`flex min-h-28 flex-col justify-between gap-3 rounded-[8px] border-2 p-4 ${tones[index % tones.length]}`}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-black">{item.label}</span>
                  <span className="mt-1 block text-[11px] font-semibold opacity-70">
                    {item.detail}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4">
        <section
          data-reveal
          data-reveal-state="hidden"
          className={`flex min-h-[200px] items-center rounded-[10px] border-2 border-[#111111] bg-[#111111] p-6 text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] ${revealBaseClass}`}
          style={{ transitionDelay: "160ms" }}
        >
          <div className="w-full space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#f2cf27] text-[#111111]">
                <Building2 className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-lg font-black">정식 등록 업체</p>
            </div>
            <details className="group rounded-[8px] border border-white/25 bg-white/5 p-3 text-sm font-semibold text-white/80">
              <summary className="cursor-pointer font-black text-white marker:text-[#f2cf27]">
                등록·증빙 정보
              </summary>
              <ul className="mt-3 space-y-2 text-xs leading-5">
                <li>통신판매업 · 대중문화예술기획업 · 음반·음악영상물제작업</li>
                <li>세금계산서 · 현금영수증 · 거래내역서 발급</li>
              </ul>
            </details>
            <div>
              <p className="text-xs font-black text-white/60">PARTNERS</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ["워터멜론", "https://www.iamwatermelon.com"],
                  ["마하픽스", "https://machfix.co.kr"],
                  ["V-House", "https://naver.me/FMckTrml"],
                ].map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[6px] border border-white/30 px-3 py-1.5 text-xs font-black transition hover:border-[#f2cf27] hover:text-[#f2cf27]"
                  >
                    {label} ↗
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          data-reveal
          data-reveal-state="hidden"
          className={`flex min-h-[200px] items-center rounded-[10px] border-2 border-[#111111] bg-card p-6 text-foreground shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] ${revealBaseClass}`}
          style={{ transitionDelay: "240ms" }}
        >
          <div className="w-full space-y-4">
            <p className="bauhaus-kicker">
              문의
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <a
                href={`tel:${APP_CONFIG.supportPhone}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                전화
              </a>
              <a
                href={`mailto:${APP_CONFIG.supportEmail}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-4 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                이메일
              </a>
            </div>
            <p className="text-center text-xs font-semibold text-muted-foreground">
              {APP_CONFIG.supportHours}
            </p>
          </div>
        </section>
      </div>
    </section>
  );
}
