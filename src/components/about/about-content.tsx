import { Building2, CalendarCheck, ExternalLink, ListChecks, Megaphone, MousePointerClick, Radio, type LucideIcon } from "lucide-react";

import { GuideTrustFacts } from "@/components/guide/trust-facts";
import { ReliableLink } from "@/components/site/reliable-link";
import { ONSIDE_FAMILY, ONSIDE_FLOW, ONSIDE_REASONS, ONSIDE_WHY_FAQS, type OnsideReason } from "@/lib/onside-why";

const reasonIcons: Record<OnsideReason["key"], LucideIcon> = {
  since: CalendarCheck,
  family: Building2,
  offices: Radio,
  online: MousePointerClick,
  progress: ListChecks,
  after: Megaphone,
};

// One solid brand colour per icon tile, in a fixed order.
const tileTones = [
  "bg-[#f2cf27] text-[#111111]",
  "bg-[#1556a4] text-white",
  "bg-[#d9362c] text-white",
  "bg-[#1f7a5a] text-white",
  "bg-[#111111] text-white",
  "bg-[#f2cf27] text-[#111111]",
];

// Each fact is stated elsewhere on the site (guides, footer, terms).
const serviceFacts = [
  { label: "음반 심의", value: "앨범·음원(디지털 싱글) 심의 · KBS·MBC·SBS 등 TV·라디오 방송국 15곳" },
  { label: "뮤직비디오 심의", value: "영등위 등급분류(온라인 유통용, Mnet 추가) · KBS·MBC·SBS 방송국별 심의 · ETN 입고" },
];

// The same standing facts for the English page (the shared table is Korean).
const englishFacts = [
  { label: "Album reviews", value: "Albums and digital singles · 15 TV and radio stations including KBS, MBC and SBS" },
  { label: "Music video reviews", value: "KMRB rating for online distribution (optional Mnet) · station reviews at KBS, MBC and SBS · ETN delivery" },
  { label: "Operator", value: "Vintage House Co., Ltd. · album and music video review submissions since 2017" },
  { label: "Payment", value: "Card or bank transfer · tax invoice, cash receipt and statement on request" },
  { label: "Refunds", value: "Full refund before submission to the stations · stations not yet submitted can be cancelled" },
  { label: "Progress", value: "Each station's status and result in your account or with a lookup code · result email" },
];

const card = "rounded-[10px] border-2 border-[#111111] bg-card dark:border-[#f2cf27]";

/**
 * The about page: why a review belongs with Onside, at a glance. Six things
 * the service does, the company behind it and its other music brands, the
 * path from application to airplay requests, the standing facts, and the
 * questions people ask first. Copy and facts live in src/lib/onside-why.ts.
 */
export function AboutContent({ english = false }: { english?: boolean }) {
  const t = (ko: string, en: string) => (english ? en : ko);
  // English text is written here, so the in-place translator leaves it alone.
  const own = english ? { lang: "en", "data-no-translate": true } : {};
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section {...own} className={`${card} relative overflow-hidden p-5 shadow-[8px_8px_0_#111111] dark:shadow-[8px_8px_0_#f2cf27] md:p-8`}>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-3 w-full bg-[#111111] dark:bg-[#f2cf27]" />
        <div className="grid gap-6 pb-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] md:items-center">
          <div>
            <p className="bauhaus-kicker">Since 2017</p>
            <h1 className="font-display mt-4 break-keep text-balance text-2xl font-black leading-tight text-foreground sm:text-3xl md:text-4xl">
              {english ? "Why Onside for Korean album and music video reviews" : (
                <>
                  음반·뮤직비디오 심의 대행,
                  <br />
                  왜 온사이드일까요
                </>
              )}
            </h1>
            <p className="mt-4 max-w-xl break-keep text-sm font-semibold leading-7 text-muted-foreground sm:text-base">
              {t(
                "온사이드는 (주)빈티지하우스가 2017년부터 운영해 온 심의 브랜드입니다. 방송국 접수부터 결과 확인까지 온라인으로 진행합니다.",
                "Onside is the review brand Vintage House Co., Ltd. has run since 2017. From station intake to results, everything happens online.",
              )}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ReliableLink
                href="/dashboard/new"
                className="inline-flex min-h-12 items-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-6 text-sm font-black text-[#111111] shadow-[4px_4px_0_#111111] transition hover:-translate-y-0.5"
              >
                {t("심의 신청", "Apply for a review")}
              </ReliableLink>
              <ReliableLink
                href="/guide/pricing"
                className="inline-flex min-h-12 items-center rounded-[8px] border-2 border-[#111111] bg-white px-6 text-sm font-black text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5"
              >
                {t("심의 비용 보기", "See pricing")}
              </ReliableLink>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 md:grid-cols-1">
            {[
              { value: t("2017년", "2017"), label: t("부터 심의 대행", "Reviewing since") },
              { value: t("18곳", "18"), label: t("방송국·영등위 접수처", "Stations and KMRB offices") },
              { value: t("5개", "5"), label: t("빈티지하우스의 음악 브랜드", "Music brands under Vintage House") },
            ].map((fact) => (
              <div key={fact.label} className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-3 dark:border-[#f2cf27]/60 md:flex md:items-baseline md:gap-3 md:px-4">
                <dd className="font-display text-xl font-black leading-none text-foreground md:text-2xl">{fact.value}</dd>
                <dt className="mt-1.5 break-keep text-[11px] font-bold leading-4 text-muted-foreground md:mt-0 md:text-sm">{fact.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section {...own} className="mt-12" aria-labelledby="why-reasons">
        <h2 id="why-reasons" className="font-display break-keep text-2xl font-black text-foreground">
          {t("온사이드를 고르는 이유", "Why people choose Onside")}
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ONSIDE_REASONS.map((reason, index) => {
            const Icon = reasonIcons[reason.key];
            return (
              <li key={reason.key} className={`${card} p-5`}>
                <span className={`flex size-11 items-center justify-center rounded-[8px] border-2 border-[#111111] ${tileTones[index % tileTones.length]}`}>
                  <Icon className="size-5" strokeWidth={2.4} aria-hidden="true" />
                </span>
                <h3 className="mt-4 break-keep text-base font-black text-foreground">{t(reason.title.ko, reason.title.en)}</h3>
                <p className="mt-2 break-keep text-sm font-semibold leading-6 text-muted-foreground">{t(reason.body.ko, reason.body.en)}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section {...own} className="mt-12" aria-labelledby="why-family">
        <h2 id="why-family" className="font-display break-keep text-2xl font-black text-foreground">
          {t("빈티지하우스가 운영하는 음악 브랜드", "The music brands Vintage House runs")}
        </h2>
        <p className="mt-2 max-w-3xl break-keep text-sm font-semibold leading-7 text-muted-foreground">
          {t(
            "심의만 하는 곳이 아닙니다. 비트마켓, 스튜디오, 아트상품 스토어, 장비 수리까지 음악 일을 함께 하는 회사의 심의 브랜드입니다.",
            "Not a review-only desk: the review brand of a company that also runs a beat market, a studio, an art-goods store and equipment repair.",
          )}
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ONSIDE_FAMILY.map((brand) => {
            const self = brand.key === "onside";
            return (
              <li
                key={brand.key}
                className={`flex flex-col rounded-[10px] border-2 border-[#111111] p-4 ${self ? "bg-[#f2cf27] text-[#111111]" : "bg-card text-foreground dark:border-[#f2cf27]"}`}
              >
                <p className={`text-[11px] font-black ${self ? "text-[#111111]" : "text-muted-foreground"}`}>{t(brand.role.ko, brand.role.en)}</p>
                <h3 className="mt-1 text-lg font-black">{t(brand.name, brand.nameEn)}</h3>
                <p className={`mt-2 break-keep text-xs font-semibold leading-5 ${self ? "text-[#111111]" : "text-muted-foreground"}`}>
                  {t(brand.description, brand.descriptionEn)}
                </p>
                {brand.url ? (
                  <a
                    href={brand.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-black underline underline-offset-4"
                  >
                    {t("사이트 보기", "Visit site")}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : self ? (
                  <p className="mt-auto pt-3 text-xs font-black">{t("지금 보고 계신 서비스", "You are here")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section {...own} className="mt-12" aria-labelledby="why-flow">
        <h2 id="why-flow" className="font-display break-keep text-2xl font-black text-foreground">
          {t("신청부터 방송 신청까지", "From application to airplay requests")}
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ONSIDE_FLOW.map((step, index) => (
            <li key={step.ko} className={`${card} flex items-center gap-3 p-4`}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#1556a4] text-sm font-black text-white">
                {index + 1}
              </span>
              <span className="break-keep text-sm font-black text-foreground">{t(step.ko, step.en)}</span>
            </li>
          ))}
        </ol>
      </section>

      {english ? (
        <section {...own} className="mt-12" aria-labelledby="why-facts">
          <h2 id="why-facts" className="font-display text-2xl font-black text-foreground">Onside at a glance</h2>
          <dl className="mt-4 overflow-hidden rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]/60">
            {englishFacts.map((fact, index) => (
              <div key={fact.label} className={`grid gap-1 bg-card px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4 ${index > 0 ? "border-t-2 border-[#111111] dark:border-[#f2cf27]/40" : ""}`}>
                <dt className="text-xs font-black text-muted-foreground sm:text-sm">{fact.label}</dt>
                <dd className="text-sm font-bold leading-6 text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <GuideTrustFacts heading="온사이드 한눈에" leadFacts={serviceFacts} />
      )}

      <section {...own} className="mt-12" aria-labelledby="why-faq">
        <h2 id="why-faq" className="font-display break-keep text-2xl font-black text-foreground">
          {t("자주 묻는 질문", "Questions people ask first")}
        </h2>
        <div className="mt-5 space-y-3">
          {ONSIDE_WHY_FAQS.map((faq) => (
            <details key={faq.question} className={`${card} px-4 py-3`}>
              <summary className="cursor-pointer break-keep text-sm font-black text-foreground sm:text-base">{t(faq.question, faq.questionEn)}</summary>
              <p className="mt-3 break-keep text-sm font-semibold leading-7 text-muted-foreground">{t(faq.answer, faq.answerEn)}</p>
            </details>
          ))}
        </div>
      </section>

      <section {...own} className={`${card} mt-12 flex flex-wrap items-center justify-between gap-4 p-5 shadow-[6px_6px_0_#111111] dark:shadow-[6px_6px_0_#f2cf27] sm:p-6`}>
        <p className="break-keep text-lg font-black text-foreground">
          {t("음반·뮤직비디오 심의, 온사이드에서 시작하세요.", "Start your album or music video review with Onside.")}
        </p>
        <div className="flex flex-wrap gap-3">
          <ReliableLink
            href="/dashboard/new"
            className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-5 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
          >
            {t("심의 신청", "Apply for a review")}
          </ReliableLink>
          <ReliableLink
            href="/guide"
            className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-[#111111] bg-white px-5 text-sm font-black text-[#111111] transition hover:-translate-y-0.5"
          >
            {t("심의 안내 보기", "Read the guides")}
          </ReliableLink>
        </div>
      </section>
    </div>
  );
}
