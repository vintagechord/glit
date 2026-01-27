import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import type { TrackReviewResult } from "@/lib/track-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";

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
  const baseSelect =
    "id, title, artist_name, type, status, payment_status, amount_krw, created_at, updated_at, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title, track_title_kr, track_title_en, composer, lyricist, arranger, lyrics, is_title, title_role, broadcast_selected )";
  const fullSelect =
  "id, title, artist_name, type, status, payment_status, payment_method, amount_krw, mv_rating, mv_certificate_object_key, mv_certificate_filename, mv_certificate_mime_type, mv_certificate_size_bytes, created_at, updated_at, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title, track_title_kr, track_title_en, composer, lyricist, arranger, lyrics, is_title, title_role, broadcast_selected )";

  const fetchSubmission = async (column: "guest_token" | "id", value: string) => {
    const { data, error } = await admin
      .from("submissions")
      .select(fullSelect)
      .eq(column, value)
      .maybeSingle();

    if (!error) {
      return data;
    }

    if (error.code === "PGRST204") {
      const { data: fallbackData } = await admin
        .from("submissions")
        .select(baseSelect)
        .eq(column, value)
        .maybeSingle();
      return fallbackData ?? null;
    }

    return null;
  };

  let submission = await fetchSubmission("guest_token", token);

  if (!submission) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      );
    if (isUuid) {
      submission = await fetchSubmission("id", token);
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
