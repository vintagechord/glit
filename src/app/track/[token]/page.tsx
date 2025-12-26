import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "비회원 진행 상황",
};

export default async function TrackDetailPage({
  params,
}: {
  params: { token: string };
}) {
  const token = decodeURIComponent(params.token ?? "");

  if (!token || token.length < 8 || token.length > 120) {
    notFound();
  }

  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, payment_method, amount_krw, created_at, updated_at, package:packages ( name, station_count, price_krw )",
    )
    .eq("guest_token", token)
    .maybeSingle();

  if (!submission) {
    notFound();
  }

  const { data: events } = await admin
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", submission.id)
    .order("created_at", { ascending: false });

  const { data: stationReviews } = await admin
    .from("station_reviews")
    .select(
      "id, status, result_note, updated_at, station:stations ( id, name, code )",
    )
    .eq("submission_id", submission.id)
    .order("updated_at", { ascending: false });

  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-6 pt-10">
        <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
          비회원 조회는 실시간 갱신이 지원되지 않습니다. 최신 정보를 보려면
          새로고침을 눌러주세요.
        </div>
      </div>
      <SubmissionDetailClient
        submissionId={submission.id}
        initialSubmission={submission}
        initialEvents={events ?? []}
        initialStationReviews={stationReviews ?? []}
        enableRealtime={false}
      />
    </>
  );
}
