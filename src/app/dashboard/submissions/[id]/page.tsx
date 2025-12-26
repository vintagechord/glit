import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "심의 상세",
};

export default async function SubmissionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerSupabase();
  const { data: submission } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, payment_method, amount_krw, created_at, updated_at, package:packages ( name, station_count, price_krw )",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!submission) {
    notFound();
  }

  const { data: events } = await supabase
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", params.id)
    .order("created_at", { ascending: false });

  const { data: stationReviews } = await supabase
    .from("station_reviews")
    .select(
      "id, status, result_note, updated_at, station:stations ( id, name, code )",
    )
    .eq("submission_id", params.id)
    .order("updated_at", { ascending: false });

  return (
    <SubmissionDetailClient
      submissionId={params.id}
      initialSubmission={submission}
      initialEvents={events ?? []}
      initialStationReviews={stationReviews ?? []}
    />
  );
}
