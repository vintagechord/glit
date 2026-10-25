import { notFound } from "next/navigation";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { normalizeTrackResults } from "@/lib/track-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPackageStations, stationNameByCode } from "@/lib/station-reviews";
import { loadSubmissionDetailRelations } from "@/lib/submissions/detail-relations";
import { decodeTrackToken } from "@/lib/track-token";

export const metadata = {
  title: "비회원 진행 상황",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SubmissionDetailClientProps = React.ComponentProps<typeof SubmissionDetailClient>;

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

  const admin = createAdminClient();
  const baseSelect =
    "id, user_id, guest_token, title, artist_name, status, payment_status, payment_method, current_order_id, amount_krw, type, created_at, updated_at, applicant_email, applicant_name, applicant_phone, guest_name, guest_email, guest_phone, guest_company, result_status, result_memo, result_notified_at, package_id, mv_selected_station_codes, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title, track_title_kr, track_title_en, performer, composer, lyricist, arranger, lyrics, is_title, broadcast_selected ), certificate_b2_path, certificate_original_name, certificate_mime, certificate_size, certificate_uploaded_at, mv_desired_rating, mv_runtime, mv_format, mv_director, mv_lead_actor, mv_distribution_company, mv_production_company, mv_usage, mv_song_title, mv_composer, mv_lyricist, mv_arranger, mv_album_title";

  const fallbackSelect =
    "id, guest_token, title, artist_name, status, type, payment_status, payment_method, current_order_id, amount_krw, result_status, result_memo, package_id, mv_selected_station_codes, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title )";

  type TrackSubmission = {
    id: string;
    title: string | null;
    artist_name: string | null;
    type: string | null;
    status: string | null;
    payment_status: string | null;
    payment_method?: string | null;
    current_order_id?: string | null;
    amount_krw: number | null;
    result_status?: string | null;
    result_memo?: string | null;
    package_id?: string | null;
    mv_selected_station_codes?: string[] | null;
    result_notified_at?: string | null;
    updated_at: string | null;
    created_at: string | null;
    album_tracks?:
      | Array<{
          id?: string | null;
          track_no?: number | null;
          track_title?: string | null;
          track_title_kr?: string | null;
          track_title_en?: string | null;
          performer?: string | null;
          broadcast_selected?: boolean | null;
        }>
      | null;
    package?:
      | Array<{ name?: string | null; station_count?: number | null; price_krw?: number | null }>
      | { name?: string | null; station_count?: number | null; price_krw?: number | null }
      | null;
  };

  const fetchSubmission = async (value: string) => {
    const { data, error } = await admin
      .from("submissions")
      .select(baseSelect)
      .is("user_id", null)
      .eq("guest_token", value)
      .maybeSingle();

    if (!error && data) return data;

    const { data: fallback } = await admin
      .from("submissions")
      .select(fallbackSelect)
      .is("user_id", null)
      .eq("guest_token", value)
      .maybeSingle();

    return fallback;
  };

  const submission = (await fetchSubmission(token)) as TrackSubmission | null;

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

  const related = await loadSubmissionDetailRelations(admin, submission.id, submission.package_id);
  for (const [name, result] of Object.entries(related)) {
    if (result.error) console.error(`[TrackDetail] ${name} load failed`, result.error);
  }
  const normalizedStationReviews = (related.reviews.data ?? [])
    .filter(review => submission.type !== "MV_BROADCAST" || !["MV_BROADCAST", "MV_ONLINE"].includes(review.station?.code ?? ""))
    .map(review => ({ ...review, track_results: normalizeTrackResults(review.track_results, submission.album_tracks) }));
  const expected = related.packageStations.data.length
    ? related.packageStations.data
    : submission.type === "ALBUM"
      ? getPackageStations(packageInfo?.station_count, packageInfo?.name).map(station => ({ ...station, id: "" }))
      : [];
  if (submission.type === "MV_BROADCAST") {
    for (const code of submission.mv_selected_station_codes ?? []) {
      if (!["MV_BROADCAST", "MV_ONLINE"].includes(code) && !expected.some(station => station.code === code)) expected.push({ id: "", code, name: stationNameByCode[code] ?? code });
    }
  }
  for (const station of expected) {
    if (normalizedStationReviews.some(review => (station.id && review.station_id === station.id) || (station.code && review.station?.code === station.code))) continue;
    normalizedStationReviews.push({
      id: `placeholder-${submission.id}-${station.code ?? station.id}`,
      submission_id: submission.id, station_id: station.id || null,
      status: "NOT_SENT", result_note: null, track_results: [],
      updated_at: submission.updated_at ?? submission.created_at ?? "",
      station,
    });
  }
  const submissionFiles = related.files.data;

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
    <SubmissionDetailClient
      submissionId={submission.id}
      initialSubmission={normalizedSubmission}
      initialStationReviews={normalizedStationReviews}
      initialFiles={submissionFiles ?? []}
      enableRealtime={false}
      guestToken={token}
      paymentState={paymentState}
      refreshIntervalMs={10000}
    />
  );
}
