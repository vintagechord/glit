import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GlobalSubmissionForm } from "@/features/global/global-submission-form";
import type { GlobalProductKey } from "@/lib/global/config";
import { GLOBAL_PRODUCTS, getGlobalProduct } from "@/lib/global/config";

export const metadata: Metadata = {
  title: "English Review Submission",
  description:
    "Submit music or music video materials for Korean broadcast review in English.",
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  params: Promise<{ service: string }>;
  searchParams?: Promise<{ type?: string | string[] }>;
};

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

function resolveProductKey(
  service: string,
  typeParam: string,
): GlobalProductKey | null {
  if (service === "album") return "album_review";
  if (service === "mv") {
    return typeParam === "broadcast"
      ? "mv_broadcast_review"
      : "mv_online_review";
  }
  return null;
}

export default async function EnglishServiceApplyPage({
  params,
  searchParams,
}: PageProps) {
  const { service } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const productKey = resolveProductKey(
    service,
    toSingle(resolvedSearchParams.type),
  );

  if (!productKey) {
    notFound();
  }

  const product = getGlobalProduct(productKey);
  if (!product) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="bauhaus-kicker">English submission</p>
          <h1 className="font-display mt-4 text-3xl font-black leading-tight sm:text-5xl">
            {product.title}
          </h1>
          <p className="mt-4 max-w-3xl text-sm font-semibold leading-7 text-muted-foreground sm:text-base">
            Fill out the same Onside review submission information in English,
            then continue to PayPal checkout. Nationality, translation request,
            ISRC, UPC, and overseas label details are kept for global applicants.
          </p>
        </div>
        <Link
          href="/en/apply"
          className="rounded-[8px] border-2 border-[#111111] bg-white px-4 py-3 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111]"
        >
          Change service
        </Link>
      </div>

      <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
        <p className="text-sm font-black uppercase tracking-normal text-foreground">
          Process
        </p>
        <div className="mt-4 grid gap-3 text-sm font-black sm:grid-cols-4">
          {["Submission", "PayPal payment", "Review progress", "Result check"].map(
            (step) => (
              <div
                key={step}
                className="rounded-[8px] border-2 border-border bg-background px-4 py-3"
              >
                {step}
              </div>
            ),
          )}
        </div>
      </div>

      <div className="mt-8">
        <GlobalSubmissionForm
          products={GLOBAL_PRODUCTS}
          initialProductKey={productKey}
          lockProduct
        />
      </div>
    </div>
  );
}
