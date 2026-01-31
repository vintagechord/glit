import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { normalizeTrackResults } from "@/lib/track-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";

export const metadata = {
  title: "비회원 진행 상황",
};

type SubmissionDetailClientProps = React.ComponentProps<typeof SubmissionDetailClient>;

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
    "id, user_id, guest_token, title, artist_name, status, payment_status, payment_method, amount_krw, type, created_at, updated_at, applicant_email, applicant_name, applicant_phone, guest_name, guest_email, guest_phone, guest_company, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title, track_title_kr, track_title_en, composer, lyricist, arranger, lyrics, is_title ), certificate_b2_path, certificate_original_name, certificate_mime, certificate_size, certificate_uploaded_at, mv_desired_rating, mv_runtime, mv_format, mv_director, mv_lead_actor, mv_distribution_company, mv_production_company, mv_usage, mv_song_title, mv_composer, mv_lyricist, mv_arranger, mv_album_title";

  const fallbackSelect =
    "id, guest_token, title, artist_name, status, type, payment_status, amount_krw, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title )";

  type TrackSubmission = {
    id: string;
    title: string | null;
    artist_name: string | null;
    type: string | null;
    status: string | null;
    payment_status: string | null;
    payment_method?: string | null;
    amount_krw: number | null;
    updated_at: string | null;
    created_at: string | null;
    album_tracks?:
      | Array<{
          id?: string | null;
          track_no?: number | null;
          track_title?: string | null;
          track_title_kr?: string | null;
          track_title_en?: string | null;
        }>
      | null;
    package?:
      | Array<{ name?: string | null; station_count?: number | null; price_krw?: number | null }>
      | { name?: string | null; station_count?: number | null; price_krw?: number | null }
      | null;
  };

  const fetchSubmission = async (column: "guest_token" | "id", value: string) => {
    const { data, error } = await admin
      .from("submissions")
      .select(baseSelect)
      .eq(column, value)
      .maybeSingle();

    if (!error && data) return data;

    const { data: fallback } = await admin
      .from("submissions")
      .select(fallbackSelect)
      .eq(column, value)
      .maybeSingle();

    return fallback;
  };

  let submission = (await fetchSubmission("guest_token", token)) as TrackSubmission | null;

  if (!submission) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      );
    if (isUuid) {
      submission = (await fetchSubmission("id", token)) as TrackSubmission | null;
    }
  }

  if (!submission) {
    notFound();
  }
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const normalizedPackage = packageInfo
    ? {
        name: packageInfo.name ?? null,
        station_count: packageInfo.station_count ?? null,
        price_krw: packageInfo.price_krw ?? null,
      }
    : null;

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
  if (stationResult.error && !stationReviews) {
    console.error("[TrackDetail] station_reviews query error", stationResult.error);
    stationReviews = [];
  }
  let normalizedStationReviews =
    stationReviews?.map((review) => {
      const station = Array.isArray(review.station) ? review.station[0] : review.station;
      return {
        ...review,
        track_results: normalizeTrackResults(review.track_results, submission.album_tracks),
        station,
      };
    }) ?? [];

  if (!normalizedStationReviews.length) {
    const fallbackUpdatedAt =
      submission.updated_at ?? submission.created_at ?? new Date().toISOString();
    const fallbackName = normalizedPackage?.name ?? "신청 방송국";
    normalizedStationReviews = [
      {
        id: `placeholder-${submission.id}`,
        status: submission.status ?? "NOT_SENT",
        result_note: null,
        track_results: [],
        updated_at: fallbackUpdatedAt,
        station: { id: fallbackName, name: fallbackName, code: null },
      },
    ];
  }

  const { data: submissionFiles } = await admin
    .from("submission_files")
    .select("id, kind, file_path, original_name, mime, size, created_at")
    .eq("submission_id", submission.id)
    .order("created_at", { ascending: false });

  const normalizedSubmission: SubmissionDetailClientProps["initialSubmission"] = {
    ...submission,
    type: submission.type ?? "ALBUM",
    status: submission.status ?? "SUBMITTED",
    payment_status: submission.payment_status ?? "UNPAID",
    amount_krw: submission.amount_krw ?? null,
    created_at: submission.created_at ?? new Date().toISOString(),
    updated_at: submission.updated_at ?? submission.created_at ?? new Date().toISOString(),
    package: normalizedPackage,
  };

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
        initialSubmission={normalizedSubmission}
        initialEvents={events ?? []}
        initialStationReviews={normalizedStationReviews}
        initialFiles={submissionFiles ?? []}
        enableRealtime={false}
        guestToken={token}
      />
    </>
  );
}
