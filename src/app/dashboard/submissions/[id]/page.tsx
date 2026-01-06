import Link from "next/link";
import type { PostgrestError } from "@supabase/supabase-js";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";

export const metadata = {
  title: "심의 상세",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const baseSelect =
  "id, user_id, artist_id, title, artist_name, artist_name_kr, artist_name_en, type, status, payment_status, payment_method, amount_krw, mv_rating_file_path, created_at, updated_at, release_date, genre, distributor, production_company, previous_release, artist_type, artist_gender, artist_members, melon_url, mv_runtime, mv_format, mv_director, mv_lead_actor, mv_storyline, mv_production_company, mv_agency, mv_album_title, mv_production_date, mv_distribution_company, mv_business_reg_no, mv_usage, mv_desired_rating, mv_memo, mv_song_title, mv_song_title_kr, mv_song_title_en, mv_song_title_official, mv_composer, mv_lyricist, mv_arranger, mv_song_memo, mv_lyrics, applicant_name, applicant_email, applicant_phone, package:packages ( name, station_count, price_krw ), album_tracks ( track_no, track_title, track_title_kr, track_title_en, composer, lyricist, arranger, lyrics, is_title, title_role, broadcast_selected )";
const fullSelect = baseSelect;

type SubmissionRow = {
  id: string;
  user_id: string | null;
  artist_id?: string | null;
  title: string | null;
  artist_name: string | null;
  artist_name_kr?: string | null;
  artist_name_en?: string | null;
  type: string;
  status: string;
  payment_status: string | null;
  payment_method?: string | null;
  amount_krw: number | null;
  mv_rating_file_path?: string | null;
  created_at: string;
  updated_at: string;
  release_date?: string | null;
  genre?: string | null;
  distributor?: string | null;
  production_company?: string | null;
  previous_release?: string | null;
  artist_type?: string | null;
  artist_gender?: string | null;
  artist_members?: string | null;
  melon_url?: string | null;
  mv_runtime?: string | null;
  mv_format?: string | null;
  mv_director?: string | null;
  mv_lead_actor?: string | null;
  mv_storyline?: string | null;
  mv_production_company?: string | null;
  mv_agency?: string | null;
  mv_album_title?: string | null;
  mv_production_date?: string | null;
  mv_distribution_company?: string | null;
  mv_business_reg_no?: string | null;
  mv_usage?: string | null;
  mv_desired_rating?: string | null;
  mv_memo?: string | null;
  mv_song_title?: string | null;
  mv_song_title_kr?: string | null;
  mv_song_title_en?: string | null;
  mv_song_title_official?: string | null;
  mv_composer?: string | null;
  mv_lyricist?: string | null;
  mv_arranger?: string | null;
  mv_song_memo?: string | null;
  mv_lyrics?: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
  package?:
    | Array<{ name?: string | null; station_count?: number | null; price_krw?: number | null }>
    | { name?: string | null; station_count?: number | null; price_krw?: number | null }
    | null;
  album_tracks?:
    | Array<{
        track_no?: number | null;
        track_title?: string | null;
        track_title_kr?: string | null;
        track_title_en?: string | null;
        composer?: string | null;
        lyricist?: string | null;
        arranger?: string | null;
        lyrics?: string | null;
        is_title?: boolean | null;
        title_role?: string | null;
        broadcast_selected?: boolean | null;
      }>
    | null;
};

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rawId = id?.trim();
  const submissionId = rawId && uuidPattern.test(rawId) ? rawId : "";

  // 디버그용: params.id만 검사 (추후 headers/search fallback 복원 가능)
  console.log("[Dashboard SubmissionDetail] incoming", {
    params: { id },
    submissionId,
  });

  if (!submissionId || !uuidPattern.test(submissionId)) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Submission
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">유효하지 않은 접수 ID입니다.</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          URL에 접수 ID가 포함되어 있는지 확인해주세요.
        </p>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          요청 ID: {submissionId || "입력 없음"}
        </div>
        <div className="mt-3 flex gap-3">
          <Link
            href="/dashboard/history"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            나의 심의 내역으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isColumnMissing = (
    error: { message?: string; code?: string } | null,
    column: string,
  ) =>
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.message?.toLowerCase().includes(column.toLowerCase());

  const isNotFoundError = (error: { message?: string; code?: string } | null) =>
    error?.code === "PGRST116" ||
    error?.message?.toLowerCase().includes("row not found") ||
    error?.message?.toLowerCase().includes("results contain 0 rows");

  const runFetch = async (
    client: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createServerSupabase>>,
    select: string,
  ) =>
    client
      .from("submissions")
      .select(select)
      .eq("id", submissionId)
      .maybeSingle();

  const fetchSubmission = async (
    client: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createServerSupabase>>,
  ): Promise<{ submission: SubmissionRow | null; error: PostgrestError | null }> => {
    let result = await runFetch(client, fullSelect);
    let submission = (result.data ?? null) as SubmissionRow | null;
    let error = result.error ?? null;

    if (submission || isNotFoundError(error)) {
      return { submission, error };
    }

    if (isColumnMissing(error, "mv_rating_file_path")) {
      result = await runFetch(
        client,
        fullSelect.replace(", mv_rating_file_path", ""),
      );
      submission = (result.data ?? null) as SubmissionRow | null;
      error = result.error ?? null;

      if (submission || isNotFoundError(error)) {
        return { submission, error };
      }
    }

    if (isColumnMissing(error, "payment_method")) {
      result = await runFetch(client, baseSelect);
      submission = (result.data ?? null) as SubmissionRow | null;
      error = result.error ?? null;
    }

    return { submission, error };
  };

  const admin = createAdminClient();
  const { submission: adminSubmission, error: adminError } =
    await fetchSubmission(admin);

  console.log("[Dashboard SubmissionDetail] admin lookup", {
    submissionId,
    found: Boolean(adminSubmission),
    error: adminError?.message,
  });

  if (!adminSubmission) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Submission
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">접수 상세를 불러올 수 없습니다.</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          요청한 접수 ID가 존재하지 않거나 조회 권한이 없습니다.
        </p>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          요청 ID: {submissionId}
        </div>
        <div className="mt-3 flex gap-3">
          <Link
            href="/dashboard/history"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            나의 심의 내역으로 돌아가기
          </Link>
          {!user ? (
            <Link
              href={`/login?next=${encodeURIComponent(`/dashboard/submissions/${submissionId}`)}`}
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              로그인 후 다시 시도
            </Link>
          ) : null}
        </div>
        {adminError ? (
          <div className="mt-2 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
            상세: {adminError.message}
          </div>
        ) : null}
      </div>
    );
  }

  if (!user || adminSubmission.user_id !== user.id) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Submission
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">접수 권한이 없습니다.</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          이 접수를 열람할 수 있는 계정으로 로그인했는지 확인해주세요.
        </p>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          요청 ID: {submissionId}
        </div>
        {!user ? (
          <div className="mt-3">
            <Link
              href={`/login?next=${encodeURIComponent(`/dashboard/submissions/${submissionId}`)}`}
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              로그인 후 다시 시도
            </Link>
          </div>
        ) : (
          <div className="mt-3">
            <Link
              href="/dashboard/history"
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              나의 심의 내역으로 돌아가기
            </Link>
          </div>
        )}
      </div>
    );
  }

  const { submission: userSubmission, error: userError } =
    await fetchSubmission(supabase);

  console.log("[Dashboard SubmissionDetail] user lookup", {
    submissionId,
    found: Boolean(userSubmission),
    error: userError?.message,
  });

  const resolvedSubmission = userSubmission ?? adminSubmission;
  const packageInfo = Array.isArray(resolvedSubmission.package)
    ? resolvedSubmission.package[0]
    : resolvedSubmission.package;

  if (resolvedSubmission.type === "ALBUM") {
    await ensureAlbumStationReviews(
      supabase,
      resolvedSubmission.id,
      packageInfo?.station_count ?? null,
      packageInfo?.name ?? null,
    );
  }

  const stationReviewsClient = userSubmission ? supabase : admin;

  const { data: events } = await supabase
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", resolvedSubmission.id)
    .order("created_at", { ascending: false });

  // 방송국별 진행: logo_url이 없는 스키마에서도 동작하도록 fallback
  const stationSelectWithLogo =
    "id, status, result_note, updated_at, station:stations ( id, name, code, logo_url )";
  const stationSelectBasic =
    "id, status, result_note, updated_at, station:stations ( id, name, code )";

  let stationReviews: typeof stationReviewsClient extends any ? any[] | null : any = null;
  let stationError: { code?: string; message?: string } | null = null;

  const runStationFetch = (select: string) =>
    stationReviewsClient
      .from("station_reviews")
      .select(select)
      .eq("submission_id", resolvedSubmission.id)
      .order("updated_at", { ascending: false });

  let stationResult = await runStationFetch(stationSelectWithLogo);
  stationReviews = stationResult.data ?? null;
  stationError = stationResult.error ?? null;

  if (
    stationError &&
    (stationError.code === "42703" ||
      stationError.message?.toLowerCase().includes("logo_url"))
  ) {
    const fallbackResult = await runStationFetch(stationSelectBasic);
    stationReviews = fallbackResult.data ?? null;
    stationError = fallbackResult.error ?? null;
  }
  const normalizedStationReviews =
    stationReviews?.map((review) => ({
      ...review,
      station: Array.isArray(review.station) ? review.station[0] : review.station,
    })) ?? [];

  const filesClient = userSubmission ? supabase : admin;
  const { data: submissionFiles } = await filesClient
    .from("submission_files")
    .select("id, kind, file_path, original_name, mime, size, created_at")
    .eq("submission_id", resolvedSubmission.id)
    .order("created_at", { ascending: false });

  return (
    <SubmissionDetailClient
      submissionId={submissionId}
      initialSubmission={{
        ...resolvedSubmission,
        package: packageInfo
          ? {
              name: packageInfo.name ?? null,
              station_count: packageInfo.station_count ?? null,
              price_krw: packageInfo.price_krw ?? null,
            }
          : null,
      }}
      initialEvents={events ?? []}
      initialStationReviews={normalizedStationReviews}
      initialFiles={submissionFiles ?? []}
    />
  );
}
