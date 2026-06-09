import type { Metadata } from "next";
import Link from "next/link";

import { GlobalSubmissionForm } from "@/features/global/global-submission-form";
import { GLOBAL_PRODUCTS } from "@/lib/global/config";

export const metadata: Metadata = {
  title: "Start Korean Broadcast Review Submission",
  description:
    "Submit music materials for Korean broadcast review with guided support from Onside.",
  alternates: {
    canonical: "/en/apply",
    languages: {
      ko: "/dashboard/new",
      en: "/en/apply",
    },
  },
};

export default function EnglishApplyPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="bauhaus-kicker">Global submission</p>
          <h1 className="font-display mt-4 text-3xl font-black leading-tight sm:text-5xl">
            Start your Korean broadcast review submission
          </h1>
          <p className="mt-4 max-w-3xl text-sm font-semibold leading-7 text-muted-foreground sm:text-base">
            Complete the form below and continue to PayPal checkout. Onside will
            review your submitted materials and contact you if additional
            information is needed.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="rounded-[8px] border-2 border-[#111111] bg-white px-3 py-2 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111]"
          >
            KR
          </Link>
          <Link
            href="/en"
            className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111] shadow-[2px_2px_0_#111111]"
          >
            EN
          </Link>
        </div>
      </div>

      <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[5px_5px_0_#111111]">
        <p className="text-sm font-black uppercase tracking-normal">Before you submit</p>
        <p className="mt-2 text-sm font-semibold leading-7">
          Onside provides submission support for Korean broadcast review.
          Approval, broadcast airplay, programming, playlisting, and royalty
          collection are not guaranteed.
        </p>
      </div>

      <div className="mt-8">
        <GlobalSubmissionForm products={GLOBAL_PRODUCTS} />
      </div>
    </div>
  );
}
