import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import type { TrackReviewResult } from "@/lib/track-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";
import { SUBMISSION_ADMIN_DETAIL_SELECT } from "@/lib/submissions/select-columns";

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
  const extractMissingColumn = (error: { message?: string; code?: string } | null) => {
    const msg = error?.message ?? "";
    const match =
      msg.match(/column\s+\"?([^\s\"']+)\"?\s+does not exist/i) ||
      msg.match(/column\s+'?([^\s\"']+)'?\s+does not exist/i);
    if (!match?.[1]) return null;
    const full = match[1];
    const parts = full.split(".");
    return parts.length > 1 ? parts[parts.length - 1] : full;
  };

  const dropColumnFromSelect = (select: string, column: string) =>
    select
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !s.includes(column))
      .join(", ");

  const fetchSubmission = async (column: "guest_token" | "id", value: string) => {
    let selectClause = SUBMISSION_ADMIN_DETAIL_SELECT;
    const maxAttempts = Math.max(6, selectClause.split(",").length);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { data, error } = await admin
        .from("submissions")
        .select(selectClause)
        .eq(column, value)
        .maybeSingle();

      if (!error) {
        return data;
      }

      const missing = extractMissingColumn(error);
      if (!missing) break;
      const next = dropColumnFromSelect(selectClause, missing);
      if (next === selectClause) break;
      selectClause = next;
    }

    return null;
  };

  let submission = (await fetchSubmission("guest_token", token)) as any;

  if (!submission) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      );
    if (isUuid) {
      submission = (await fetchSubmission("id", token)) as any;
    }
  }

  if (!submission) {
    notFound();
  }
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;

  if (submission.type === "ALBUM") {
    await ensureAlbumStationReviews(
      admin,
      submission.id,
      packageInfo?.station_count ?? null,
      packageInfo?.name ?? null,
    );
  }

  const { data: events } = await admin
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", submission.id)
    .order("created_at", { ascending: false });

  const stationSelectWithTracks =
    "id, status, result_note, track_results, updated_at, station:stations ( id, name, code )";
  const stationSelectNoTracks =
    "id, status, result_note, updated_at, station:stations ( id, name, code )";

  const stationResult = await admin
    .from("station_reviews")
    .select(stationSelectWithTracks)
    .eq("submission_id", submission.id)
    .order("updated_at", { ascending: false });

  let stationReviews =
    (stationResult.data as
      | Array<{
          id: string;
          status: string;
          result_note: string | null;
          track_results?: unknown;
          updated_at: string;
          station: Array<{ id: string; name: string | null; code: string | null }>;
        }>
      | null) ?? null;
  if (
    stationResult.error &&
    (stationResult.error.code === "42703" ||
      stationResult.error.message?.toLowerCase().includes("track_results"))
  ) {
    const fallback = await admin
      .from("station_reviews")
      .select(stationSelectNoTracks)
      .eq("submission_id", submission.id)
      .order("updated_at", { ascending: false });
    stationReviews = (fallback.data as typeof stationReviews) ?? stationReviews;
  }
  const normalizedStationReviews =
    stationReviews?.map((review) => ({
      ...review,
      track_results: review.track_results as TrackReviewResult[] | null | undefined,
      station: Array.isArray(review.station) ? review.station[0] : review.station,
    })) ?? [];

  const { data: submissionFiles } = await admin
    .from("submission_files")
    .select("id, kind, file_path, original_name, mime, size, created_at")
    .eq("submission_id", submission.id)
    .order("created_at", { ascending: false });

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
        initialSubmission={{ ...submission, package: packageInfo ?? null }}
        initialEvents={events ?? []}
        initialStationReviews={normalizedStationReviews}
        initialFiles={submissionFiles ?? []}
        enableRealtime={false}
        guestToken={token}
      />
    </>
  );
}
