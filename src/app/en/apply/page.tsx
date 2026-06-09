import type { Metadata } from "next";
import { FileCheck2, MonitorPlay, RadioTower } from "lucide-react";

import { ReliableLink } from "@/components/site/reliable-link";
import type { GlobalProductKey } from "@/lib/global/config";
import { GLOBAL_PRODUCTS } from "@/lib/global/config";

export const metadata: Metadata = {
  title: "Start Review Submission",
  description:
    "Choose an Onside review service and submit music materials for Korean broadcast review in English.",
  alternates: {
    canonical: "/en/apply",
    languages: {
      ko: "/dashboard/new",
      en: "/en/apply",
    },
  },
};

const hrefByProductKey: Record<GlobalProductKey, string> = {
  album_review: "/en/apply/album",
  mv_online_review: "/en/apply/mv",
  mv_broadcast_review: "/en/apply/mv?type=broadcast",
};

const iconByProductKey: Record<GlobalProductKey, typeof FileCheck2> = {
  album_review: FileCheck2,
  mv_online_review: MonitorPlay,
  mv_broadcast_review: RadioTower,
};

const toneByIndex = [
  "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  "border-[#111111] bg-[#1556a4] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[6px_6px_0_#f2cf27]",
  "border-[#111111] bg-[#d9362c] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
];

export default function EnglishApplyPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card px-6 py-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-10">
        <p className="bauhaus-kicker">Review submission</p>
        <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
          What would you like to submit?
        </h1>
        <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground sm:text-base">
          <li>You can submit as a guest or continue after login.</li>
          <li>English submissions follow the same Onside review process, with PayPal checkout.</li>
        </ul>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {GLOBAL_PRODUCTS.map((product, index) => {
            const Icon = iconByProductKey[product.key];
            return (
              <ReliableLink
                key={product.key}
                href={hrefByProductKey[product.key]}
                className={`group rounded-[10px] border-2 p-6 transition duration-200 hover:-translate-y-1 hover:shadow-[9px_9px_0_#111111] ${toneByIndex[index]}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black uppercase tracking-normal opacity-75">
                    PayPal · USD
                  </p>
                  <Icon className="h-6 w-6" strokeWidth={2.6} />
                </div>
                <h2 className="mt-4 text-[27px] font-black leading-tight tracking-normal">
                  {product.title}
                </h2>
                <p className="mt-3 text-sm font-semibold leading-6 opacity-82">
                  {product.description}
                </p>
                <p className="mt-5 text-2xl font-black">
                  ${product.amountUsd.toLocaleString("en-US")}
                </p>
                <div className="mt-6 inline-flex items-center gap-2 border-2 border-current bg-white px-4 py-2 text-sm font-black text-[#111111]">
                  Start
                  <span className="transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </ReliableLink>
            );
          })}
        </div>
      </section>

      <div className="mt-5 rounded-[10px] border-2 border-[#111111] bg-white px-5 py-4 text-sm font-semibold leading-6 text-muted-foreground shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
        If large media files are hard to upload, submit the form first and send
        only the files by email after contacting Onside.
      </div>
    </div>
  );
}
