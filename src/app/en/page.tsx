import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileCheck2, Globe2, Languages } from "lucide-react";

import { GLOBAL_PRODUCTS } from "@/lib/global/config";
import { getOnsideMessage } from "@/lib/i18n/onside";

const t = (key: string) => getOnsideMessage("en", key);

export const metadata: Metadata = {
  title: "Korean Broadcast Review Submission Service | Onside",
  description:
    "Onside helps overseas artists, labels, and distributors prepare and submit music materials for Korean broadcast review.",
  alternates: {
    canonical: "/en",
    languages: {
      ko: "/",
      en: "/en",
    },
  },
  openGraph: {
    title: "Korean Broadcast Review Submission Service | Onside",
    description:
      "Onside helps overseas artists, labels, and distributors prepare and submit music materials for Korean broadcast review.",
    url: "/en",
    siteName: "Onside",
    locale: "en_US",
  },
};

const requirements = [
  "Music metadata, artist and label information",
  "Original lyrics and Korean lyric translation status",
  "Audio file link, cover image link, and optional video URL",
  "Rights holder and distributor information",
];

export default function EnglishHomePage() {
  return (
    <div className="bg-[#fffaf0] text-foreground dark:bg-[#101010]">
      <section className="border-b-2 border-[#111111] dark:border-[#f2cf27]">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-16">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="bauhaus-kicker">Global</span>
              <Link
                href="/"
                className="rounded-[8px] border-2 border-[#111111] bg-white px-3 py-1.5 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white"
              >
                KR
              </Link>
              <Link
                href="/en"
                className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1.5 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111] dark:border-[#f2cf27]"
              >
                EN
              </Link>
            </div>
            <h1 className="font-display mt-6 max-w-4xl break-keep text-4xl font-black leading-tight sm:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-foreground/74 dark:text-white/76">
              {t("hero.subtitle")}
            </p>
            <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-foreground/70 dark:text-white/70">
              Planning to promote your music in Korea? Korean broadcasters may
              require music, lyrics, translations, artwork, and related metadata
              before a song or video can be reviewed for broadcast use.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/en/apply"
                className="bauhaus-button inline-flex items-center gap-2 px-5 py-3 text-sm uppercase"
              >
                {t("hero.cta_primary")}
                <ArrowRight size={16} strokeWidth={2.8} />
              </Link>
              <a
                href="#requirements"
                className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-3 text-sm font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
              >
                {t("hero.cta_secondary")}
              </a>
            </div>
          </div>

          <aside className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]">
            <p className="text-sm font-black uppercase tracking-normal text-foreground/72">
              Important notice
            </p>
            <p className="mt-3 text-sm font-semibold leading-7 text-muted-foreground">
              {t("notice.no_guarantee")}
            </p>
            <p className="mt-3 text-sm font-semibold leading-7 text-muted-foreground">
              Broadcast review requirements may vary depending on broadcaster,
              content type, language, and submitted materials.
            </p>
          </aside>
        </div>
      </section>

      <section id="services" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="bauhaus-kicker">Services</p>
            <h2 className="mt-4 text-3xl font-black">
              Korean Broadcast Music Review Service
            </h2>
          </div>
          <Link href="/en/apply" className="text-sm font-black text-foreground underline">
            Start with PayPal checkout
          </Link>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {GLOBAL_PRODUCTS.map((product, index) => {
            const Icon =
              product.key === "music_review"
                ? FileCheck2
                : product.key === "mv_review"
                  ? Globe2
                  : Languages;
            const tone =
              index === 0
                ? "bg-[#f2cf27] text-[#111111]"
                : index === 1
                  ? "bg-[#1556a4] text-white"
                  : "bg-[#d9362c] text-white";
            return (
              <article
                key={product.key}
                className={`flex min-h-[320px] flex-col rounded-[10px] border-2 border-[#111111] p-5 shadow-[6px_6px_0_#111111] ${tone}`}
              >
                <Icon className="h-9 w-9" strokeWidth={2.4} />
                <h3 className="mt-6 text-2xl font-black leading-tight">
                  {product.title}
                </h3>
                <p className="mt-4 text-sm font-semibold leading-6 opacity-85">
                  {product.description}
                </p>
                <ul className="mt-5 space-y-2 text-sm font-semibold opacity-85">
                  {product.includes.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
                <p className="mt-auto pt-6 text-3xl font-black">
                  ${product.amountUsd.toLocaleString("en-US")}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section
        id="requirements"
        className="border-y-2 border-[#111111] bg-card py-12 dark:border-[#f2cf27]"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[0.8fr_1fr]">
          <div>
            <p className="bauhaus-kicker">Requirements</p>
            <h2 className="mt-4 text-3xl font-black">
              Prepare materials before submission
            </h2>
            <p className="mt-4 text-sm font-semibold leading-7 text-muted-foreground">
              Onside supports the submission process for Korean broadcast
              review. We may contact you if additional materials are required.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {requirements.map((item) => (
              <div
                key={item}
                className="rounded-[8px] border-2 border-border bg-background px-4 py-4 text-sm font-black"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-6 text-[#111111] shadow-[6px_6px_0_#111111]">
          <p className="text-sm font-black uppercase tracking-normal">Disclaimer</p>
          <p className="mt-3 text-lg font-black leading-8">{t("notice.no_guarantee")}</p>
          <p className="mt-2 text-sm font-semibold leading-6">
            {t("notice.not_distribution")}
          </p>
        </div>
      </section>

      <section id="faq" className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6">
        <p className="bauhaus-kicker">{t("faq.title")}</p>
        <div className="mt-5 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
          <h2 className="text-xl font-black">{t("faq.q1")}</h2>
          <p className="mt-3 text-sm font-semibold leading-7 text-muted-foreground">
            {t("faq.a1")}
          </p>
        </div>
      </section>
    </div>
  );
}
