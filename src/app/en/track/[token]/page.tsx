import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Review Progress",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
};

type SubmissionRow = {
  id: string;
  guest_token?: string | null;
  title?: string | null;
  artist_name?: string | null;
  type?: string | null;
  status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_currency?: string | null;
  payment_amount?: number | null;
  result_status?: string | null;
  result_memo?: string | null;
  result_notified_at?: string | null;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_uploaded_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StationReviewRow = {
  id: string;
  status: string | null;
  result_note: string | null;
  updated_at: string | null;
  station:
    | Array<{ name?: string | null; code?: string | null }>
    | { name?: string | null; code?: string | null }
    | null;
};

const statusLabels: Record<string, string> = {
  DRAFT: "Draft",
  WAITING_PAYMENT: "Payment pending",
  PAYMENT_PENDING: "Payment pending",
  SUBMITTED: "Submitted",
  PAYMENT_CONFIRMED: "Payment confirmed",
  IN_REVIEW: "In review",
  REVIEWING: "In review",
  RESULT_READY: "Result ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const typeLabels: Record<string, string> = {
  ALBUM: "Album Review",
  MV_DISTRIBUTION: "Music Video Online Review",
  MV_BROADCAST: "Music Video TV Broadcast Review",
};

const paymentLabels: Record<string, string> = {
  PAID: "Paid",
  PAYMENT_PENDING: "Payment pending",
  UNPAID: "Unpaid",
  REFUNDED: "Refunded",
};

const reviewLabels: Record<string, string> = {
  NOT_SENT: "Not sent",
  RECEIVED: "Received",
  IN_REVIEW: "In review",
  REVIEWING: "In review",
  RESULT_NOTIFIED: "Result notified",
  RESULT_READY: "Result ready",
  COMPLETED: "Completed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const labelStatus = (value?: string | null) =>
  value ? statusLabels[value] ?? value.replaceAll("_", " ") : "-";

const labelPayment = (value?: string | null) =>
  value ? paymentLabels[value] ?? value.replaceAll("_", " ") : "-";

const labelReview = (value?: string | null) =>
  value ? reviewLabels[value] ?? value.replaceAll("_", " ") : "-";

async function loadSubmission(token: string) {
  const admin = createAdminClient();
  const selectWithEnglish =
    "id, guest_token, title, artist_name, type, status, payment_status, payment_method, payment_provider, payment_currency, payment_amount, result_status, result_memo, result_notified_at, certificate_b2_path, certificate_original_name, certificate_uploaded_at, created_at, updated_at";
  const selectFallback =
    "id, guest_token, title, artist_name, type, status, payment_status, payment_method, result_status, result_memo, result_notified_at, certificate_b2_path, certificate_original_name, certificate_uploaded_at, created_at, updated_at";

  const fetchBy = async (column: "guest_token" | "id", value: string) => {
    const primary = await admin
      .from("submissions")
      .select(selectWithEnglish)
      .eq(column, value)
      .maybeSingle();

    if (!primary.error && primary.data) {
      return primary.data as SubmissionRow;
    }

    const fallback = await admin
      .from("submissions")
      .select(selectFallback)
      .eq(column, value)
      .maybeSingle();

    return (fallback.data as SubmissionRow | null) ?? null;
  };

  let submission = await fetchBy("guest_token", token);
  if (!submission) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      );
    if (isUuid) {
      submission = await fetchBy("id", token);
    }
  }

  if (!submission) return null;

  const { data: stationReviews } = await admin
    .from("station_reviews")
    .select("id, status, result_note, updated_at, station:stations ( name, code )")
    .eq("submission_id", submission.id)
    .order("updated_at", { ascending: false });

  return {
    submission,
    stationReviews: (stationReviews as StationReviewRow[] | null) ?? [],
  };
}

export default async function EnglishTrackDetailPage({ params }: PageProps) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken ?? "");
  if (!token || token.length < 8 || token.length > 120) {
    notFound();
  }

  const result = await loadSubmission(token);
  if (!result) {
    notFound();
  }

  const { submission, stationReviews } = result;
  const typeLabel = typeLabels[submission.type ?? ""] ?? submission.type ?? "-";
  const isPaid = submission.payment_status === "PAID";
  const certificateHref = submission.certificate_b2_path
    ? `/api/b2/download?filePath=${encodeURIComponent(
        submission.certificate_b2_path,
      )}&guestToken=${encodeURIComponent(submission.guest_token ?? token)}`
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="bauhaus-kicker">Review progress</p>
          <h1 className="font-display mt-4 text-3xl font-black leading-tight sm:text-5xl">
            {submission.artist_name ?? "Artist"} · {submission.title ?? "Submission"}
          </h1>
          <p className="mt-3 text-sm font-semibold text-muted-foreground">
            {typeLabel} · Submitted {formatDate(submission.created_at)}
          </p>
        </div>
        <Link
          href="/en/track"
          className="rounded-[8px] border-2 border-[#111111] bg-white px-4 py-3 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111]"
        >
          New lookup
        </Link>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            Payment
          </p>
          <p className="mt-3 text-2xl font-black">
            {labelPayment(submission.payment_status)}
          </p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            {submission.payment_provider ?? submission.payment_method ?? "PayPal"}
            {submission.payment_amount
              ? ` · ${submission.payment_currency ?? "USD"} ${Number(
                  submission.payment_amount,
                ).toLocaleString("en-US")}`
              : ""}
          </p>
        </div>
        <div className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            Review status
          </p>
          <p className="mt-3 text-2xl font-black">{labelStatus(submission.status)}</p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            Updated {formatDate(submission.updated_at)}
          </p>
        </div>
        <div
          className={`rounded-[10px] border-2 border-[#111111] p-5 shadow-[5px_5px_0_#111111] ${
            isPaid ? "bg-[#f2cf27] text-[#111111]" : "bg-card"
          }`}
        >
          <p className="text-xs font-black uppercase tracking-normal opacity-75">
            Result file
          </p>
          <p className="mt-3 text-2xl font-black">
            {submission.certificate_b2_path ? "Available" : "Not ready"}
          </p>
          {certificateHref ? (
            <a
              href={certificateHref}
              className="mt-3 inline-flex rounded-[8px] border-2 border-[#111111] bg-white px-3 py-2 text-xs font-black uppercase tracking-normal text-[#111111]"
            >
              Download certificate
            </a>
          ) : null}
        </div>
      </section>

      {submission.result_memo || submission.result_status ? (
        <section className="mt-6 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
          <p className="text-sm font-black uppercase tracking-normal">
            Final result
          </p>
          <p className="mt-3 text-lg font-black">
            {submission.result_status ?? "Result memo"}
          </p>
          {submission.result_memo ? (
            <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-muted-foreground">
              {submission.result_memo}
            </p>
          ) : null}
          <p className="mt-3 text-xs font-semibold text-muted-foreground">
            Notified {formatDate(submission.result_notified_at)}
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-normal">
              Broadcaster progress
            </p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              Updates entered by Onside administrators are reflected here.
            </p>
          </div>
          <span className="rounded-[8px] border-2 border-border bg-background px-3 py-2 text-xs font-black">
            {stationReviews.length} rows
          </span>
        </div>

        <div className="mt-4 overflow-hidden rounded-[8px] border-2 border-border">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-background text-xs font-black uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Broadcaster</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {stationReviews.length ? (
                stationReviews.map((review) => {
                  const station = Array.isArray(review.station)
                    ? review.station[0]
                    : review.station;
                  return (
                    <tr key={review.id} className="border-t border-border">
                      <td className="px-4 py-3 font-black">
                        {station?.name ?? station?.code ?? "Broadcaster"}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {labelReview(review.status)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-muted-foreground">
                        {review.result_note ?? "-"}
                      </td>
                      <td className="px-4 py-3 font-semibold text-muted-foreground">
                        {formatDate(review.updated_at)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm font-semibold text-muted-foreground"
                  >
                    Progress rows will appear after Onside starts broadcaster review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
