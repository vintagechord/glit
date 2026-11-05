import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { recordCustomerResultViewAfterResponse } from "@/lib/customer-result-tracking";
import { loadCustomerSubmissionDetail } from "@/lib/submissions/customer-detail";
import { decodeTrackToken } from "@/lib/track-token";

export const metadata = {
  title: "비회원 진행 상황",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TrackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ payment?: string | string[] | undefined }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const token = decodeTrackToken(resolvedParams.token);
  const paymentState = Array.isArray(resolvedSearchParams.payment)
    ? resolvedSearchParams.payment[0]
    : resolvedSearchParams.payment;

  if (!token) {
    notFound();
  }

  // The lookup code is the only proof: the service-role read is scoped to a
  // guest submission with exactly this token.
  const detail = await loadCustomerSubmissionDetail(createAdminClient(), { guestToken: token }, {
    onError: (name, error) => console.error(`[TrackDetail] ${name} load failed`, error),
  });

  if (!detail) {
    notFound();
  }

  // The customer opened their result page. An administrator following the
  // guest link from the admin pages is not the customer.
  const viewer = await createServerSupabase().then(async (supabase) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return "guest";
    const { data: isAdmin } = await supabase.rpc("is_admin");
    return isAdmin === true ? "admin" : "member";
  }).catch(() => "unknown");
  if (viewer !== "admin" && viewer !== "unknown") recordCustomerResultViewAfterResponse(detail.submission.id);

  return (
    <SubmissionDetailClient
      submissionId={detail.submission.id}
      initialSubmission={detail.submission}
      initialStationReviews={detail.stationReviews}
      initialFiles={detail.files}
      enableRealtime={false}
      guestToken={token}
      paymentState={paymentState}
      refreshIntervalMs={60000}
    />
  );
}
