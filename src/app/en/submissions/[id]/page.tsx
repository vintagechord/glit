import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "English Submission Status",
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    guestToken?: string | string[];
    payment?: string | string[];
  }>;
};

type GlobalSubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method?: string | null;
  guest_token?: string | null;
  payment_provider?: string | null;
  payment_currency?: string | null;
  payment_amount?: number | null;
  paypal_order_id?: string | null;
  paypal_capture_id?: string | null;
};

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

async function getSubmission(id: string, guestToken: string) {
  const admin = createAdminClient();
  const selectWithGlobal =
    "id, title, artist_name, status, payment_status, payment_method, guest_token, payment_provider, payment_currency, payment_amount, paypal_order_id, paypal_capture_id";
  const selectFallback =
    "id, title, artist_name, status, payment_status, payment_method, guest_token";

  const primary = await admin
    .from("submissions")
    .select(selectWithGlobal)
    .eq("id", id)
    .maybeSingle();

  let row = primary.data as GlobalSubmissionRow | null;
  let error = primary.error;

  if (error?.code === "PGRST204" || error?.code === "42703") {
    const fallback = await admin
      .from("submissions")
      .select(selectFallback)
      .eq("id", id)
      .maybeSingle();
    row = fallback.data as GlobalSubmissionRow | null;
    error = fallback.error;
  }

  if (error || !row) return null;
  if (row.guest_token && guestToken && row.guest_token === guestToken) {
    return row;
  }
  return null;
}

export default async function GlobalSubmissionStatusPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const guestToken = toSingle(resolvedSearchParams.guestToken);
  const payment = toSingle(resolvedSearchParams.payment);
  const submission = await getSubmission(id, guestToken);

  if (!submission) {
    notFound();
  }

  const isPaid = submission.payment_status === "PAID";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="bauhaus-kicker">English submission</p>
      <h1 className="font-display mt-4 text-3xl font-black">
        Submission status
      </h1>
      <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[6px_6px_0_#111111]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              Artist / Title
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {submission.artist_name ?? "Artist"} - {submission.title ?? "Submission"}
            </h2>
          </div>
          <span
            className={`rounded-[8px] border-2 px-3 py-2 text-xs font-black ${
              isPaid
                ? "border-[#111111] bg-[#f2cf27] text-[#111111]"
                : "border-[#111111] bg-white text-[#111111]"
            }`}
          >
            {isPaid ? "Payment confirmed" : "Payment pending"}
          </span>
        </div>

        <dl className="mt-6 grid gap-3 text-sm font-semibold sm:grid-cols-2">
          <div className="rounded-[8px] border border-border bg-background p-3">
            <dt className="text-muted-foreground">Review status</dt>
            <dd className="mt-1 text-foreground">{submission.status ?? "-"}</dd>
          </div>
          <div className="rounded-[8px] border border-border bg-background p-3">
            <dt className="text-muted-foreground">Payment</dt>
            <dd className="mt-1 text-foreground">
              {submission.payment_provider ?? submission.payment_method ?? "PayPal"} /{" "}
              {submission.payment_status ?? "-"}
            </dd>
          </div>
          <div className="rounded-[8px] border border-border bg-background p-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="mt-1 text-foreground">
              {submission.payment_currency ?? "USD"}{" "}
              {Number(submission.payment_amount ?? 0).toLocaleString("en-US")}
            </dd>
          </div>
          <div className="rounded-[8px] border border-border bg-background p-3">
            <dt className="text-muted-foreground">PayPal order</dt>
            <dd className="mt-1 break-all text-foreground">
              {submission.paypal_order_id ?? "-"}
            </dd>
          </div>
        </dl>

        {payment === "cancelled" ? (
          <p className="mt-5 rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-3 text-sm font-semibold text-[#111111]">
            PayPal checkout was cancelled. Your submission is saved, but payment
            is still pending.
          </p>
        ) : null}

        <p className="mt-6 text-sm font-semibold leading-7 text-muted-foreground">
          Onside will review submitted materials after payment is confirmed.
          You can use the lookup code to check the same submission from the
          English progress page.
        </p>
        {submission.guest_token ? (
          <Link
            href={`/en/track/${encodeURIComponent(submission.guest_token)}`}
            className="mt-4 inline-flex rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111]"
          >
            Open progress page
          </Link>
        ) : null}
      </div>

      <Link
        href="/en"
        className="mt-8 inline-flex rounded-[8px] border-2 border-[#111111] bg-white px-4 py-3 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111]"
      >
        Back to English home
      </Link>
    </div>
  );
}
