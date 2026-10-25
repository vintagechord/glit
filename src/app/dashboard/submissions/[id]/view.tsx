import type { PostgrestError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import Link from "next/link";
import type React from "react";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { getStationLogoPath } from "@/lib/station-logos";
import { getPackageStations, stationNameByCode } from "@/lib/station-reviews";
import { loadSubmissionDetailRelations, type DetailStationReview } from "@/lib/submissions/detail-relations";
import { normalizeTrackResults } from "@/lib/track-results";
import {
  PAYMENT_RESULT_GRANT_COOKIE,
  readPaymentResultGrant,
} from "@/lib/payment-result-grant";
import { SUBMISSION_USER_DETAIL_SELECT } from "@/lib/submissions/select-columns";

const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const lightSelect = SUBMISSION_USER_DETAIL_SELECT;

type SubmissionDetailClientProps = React.ComponentProps<typeof SubmissionDetailClient>;

type SubmissionRow = {
  id: string;
  user_id: string | null;
  artist_id?: string | null;
  title: string | null;
  artist_name: string | null;
  artist_name_kr?: string | null;
  artist_name_en?: string | null;
  ai_used?: boolean | null;
  type: string;
  status: string;
  payment_status: string | null;
  payment_method?: string | null;
  amount_krw: number | null;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_mime?: string | null;
  certificate_size?: number | null;
  certificate_uploaded_at?: string | null;
  result_status?: string | null;
  result_memo?: string | null;
  result_notified_at?: string | null;
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
  mv_selected_station_codes?: string[] | null;
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
  package_id?: string | null;
  package?:
    | Array<{ name?: string | null; station_count?: number | null; price_krw?: number | null }>
    | { name?: string | null; station_count?: number | null; price_krw?: number | null }
    | null;
  album_tracks?:
    | Array<{
        id?: string | null;
        track_no?: number | null;
        track_title?: string | null;
        track_title_kr?: string | null;
        track_title_en?: string | null;
        performer?: string | null;
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

export type SubmissionDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ payment?: string | string[] | undefined; view?: string | string[] | undefined }>;
};

/** Shared by the Korean page and its /en mirror; page files stay thin so
 * Next.js page-prop typing is unaffected by the locale argument. */
export async function SubmissionDetailPageView({
  params,
  searchParams,
  localePrefix = "",
}: SubmissionDetailPageProps & {
  /** "/en" when rendered through the English mirror route. */
  localePrefix?: "" | "/en";
}) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const rawId = id?.trim();
  const submissionId = rawId && uuidPattern.test(rawId) ? rawId : "";
  const paymentState = Array.isArray(resolvedSearchParams.payment)
    ? resolvedSearchParams.payment[0]
    : resolvedSearchParams.payment;

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
            href={`${localePrefix}/dashboard/history`}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            나의 심의 내역으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  const cookieStore = await cookies();
  const paymentResultGrant = readPaymentResultGrant(
    cookieStore.get(PAYMENT_RESULT_GRANT_COOKIE)?.value,
    { submissionId },
  );

  const extractMissingColumn = (error: PostgrestError | null) => {
    const msg = error?.message ?? "";
    const match =
      msg.match(/column\s+\"?([^\s\"']+)\"?\s+does not exist/i) ||
      msg.match(/column\s+'?([^\s\"']+)'?\s+does not exist/i);
    if (!match?.[1]) return null;
    const full = match[1];
    const parts = full.split(".");
    return parts[parts.length - 1];
  };

  const dropColumnFromSelect = (select: string, column: string) =>
    select
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !s.includes(column))
      .join(", ");

  const fetchSubmission = async (
    client: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createServerSupabase>>,
  ): Promise<{ submission: SubmissionRow | null; error: PostgrestError | null }> => {
    let selectClause = lightSelect;
    let submission: SubmissionRow | null = null;
    let error: PostgrestError | null = null;
    const maxAttempts = Math.max(6, selectClause.split(",").length);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let query = client.from("submissions").select(selectClause).eq("id", submissionId);
      if (resolvedSearchParams.view === "archive-result") {
        // Archive popups only show the signed-in member's own active records,
        // including when an administrator opens the member-facing route.
        query = query.eq("user_id", user?.id ?? "00000000-0000-0000-0000-000000000000").is("user_deleted_at", null);
      }
      const { data, error: err } = await query.maybeSingle();
      submission = (data as SubmissionRow | null) ?? null;
      error = err as PostgrestError | null;
      if (!error) break;

      const missing = extractMissingColumn(error);
      if (!missing) break;
      const next = dropColumnFromSelect(selectClause, missing);
      if (next === selectClause) break;
      selectClause = next;
    }
    return { submission, error };
  };

  const admin = createAdminClient();
  const memberResult = user
    ? await fetchSubmission(supabase)
    : { submission: null, error: null };
  let adminSubmission = memberResult.submission;
  let hasGuestPaymentResultGrant = false;

  // A service-role detail read is allowed only after a signed result grant is
  // bound to this exact guest submission. Ordinary member access stays on RLS.
  if (!adminSubmission && paymentResultGrant?.guestToken) {
    const { data: guestGrantMatch, error: guestGrantError } = await admin
      .from("submissions")
      .select("id")
      .eq("id", submissionId)
      .is("user_id", null)
      .eq("guest_token", paymentResultGrant.guestToken)
      .maybeSingle();
    if (guestGrantError) {
      console.error(
        "[Dashboard SubmissionDetail] payment result grant verification failed",
        guestGrantError,
      );
    } else if (guestGrantMatch?.id) {
      const guestResult = await fetchSubmission(admin);
      adminSubmission = guestResult.submission;
      if (guestResult.error) {
        console.error(
          "[Dashboard SubmissionDetail] authorized guest detail load failed",
          guestResult.error,
        );
      }
      hasGuestPaymentResultGrant = Boolean(guestResult.submission);
    }
  }

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
            href={`${localePrefix}/dashboard/history`}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            나의 심의 내역으로 돌아가기
          </Link>
          {!user ? (
            <Link
              href={`${localePrefix}/login?next=${encodeURIComponent(`${localePrefix}/dashboard/submissions/${submissionId}`)}`}
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              로그인 후 다시 시도
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const isMemberOwner = Boolean(memberResult.submission);

  if (!isMemberOwner && !hasGuestPaymentResultGrant) {
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
              href={`${localePrefix}/login?next=${encodeURIComponent(`${localePrefix}/dashboard/submissions/${submissionId}`)}`}
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              로그인 후 다시 시도
            </Link>
          </div>
        ) : (
          <div className="mt-3">
            <Link
              href={`${localePrefix}/dashboard/history`}
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              나의 심의 내역으로 돌아가기
            </Link>
          </div>
        )}
      </div>
    );
  }

  const fallbackPackage =
    adminSubmission?.package_id && !adminSubmission.package
      ? await (async () => {
          const { data, error } = await admin
            .from("packages")
            .select("id, name, station_count, price_krw")
            .eq("id", adminSubmission.package_id)
            .maybeSingle();
          if (error) {
            console.error("[Dashboard SubmissionDetail] package fallback error", error);
          }
          return data ?? null;
        })()
      : null;

  const userSubmission = memberResult.submission;

  const resolvedSubmission = {
    ...(userSubmission ?? adminSubmission),
    package:
      (userSubmission ?? adminSubmission)?.package ??
      (fallbackPackage ? [fallbackPackage] : null),
  };
  const packageInfo = Array.isArray(resolvedSubmission.package)
    ? resolvedSubmission.package[0]
    : resolvedSubmission.package;

  const initialSubmission = {
    ...resolvedSubmission,
    payment_status: resolvedSubmission.payment_status ?? "",
    package: packageInfo
      ? {
          name: packageInfo.name ?? null,
          station_count: packageInfo.station_count ?? null,
          price_krw: packageInfo.price_krw ?? null,
        }
      : null,
  };

  // Build initial station reviews (package stations + existing reviews) for SSR
  const packageId = adminSubmission?.package_id ?? fallbackPackage?.id ?? null;
  const packageMapEntry = packageId
    ? { id: packageId, name: fallbackPackage?.name ?? null, station_count: fallbackPackage?.station_count ?? null }
    : null;

  const related = await loadSubmissionDetailRelations(
    hasGuestPaymentResultGrant ? admin : supabase,
    submissionId,
    packageId,
  );
  for (const [name, result] of Object.entries(related)) {
    if (result.error) console.error(`[Dashboard SubmissionDetail] ${name} load failed`, result.error);
  }
  let packageStations = related.packageStations.data;

  if (resolvedSubmission.type === "MV_BROADCAST") {
    for (const code of resolvedSubmission.mv_selected_station_codes ?? []) {
      if (!["MV_BROADCAST", "MV_ONLINE"].includes(code) && !packageStations.some(station => station.code === code)) packageStations.push({ id: "", code, name: stationNameByCode[code] ?? code });
    }
  }

  if (!packageStations.length && resolvedSubmission.type === "ALBUM") {
    const pkg = Array.isArray(resolvedSubmission.package)
      ? resolvedSubmission.package[0]
      : resolvedSubmission.package;
    const resolvedCount = pkg?.station_count ?? packageMapEntry?.station_count ?? null;
    const resolvedName = pkg?.name ?? packageMapEntry?.name ?? null;
    packageStations = getPackageStations(resolvedCount, resolvedName).map((station) => ({
      id: "",
      code: station.code,
      name: station.name,
    }));
  }

  const resolvedStationReviews = related.reviews.data;

  const reviewMap = new Map<string, DetailStationReview>();
  const reviewByCode = new Map<string, DetailStationReview>();
  (resolvedStationReviews ?? []).forEach((review: DetailStationReview) => {
    const station = Array.isArray(review.station) ? review.station[0] : review.station;
    if (resolvedSubmission.type === "MV_BROADCAST" && ["MV_BROADCAST", "MV_ONLINE"].includes(station?.code ?? "")) return;
    const stationId =
      review.station_id ||
      station?.id;
    if (!stationId) return;
    const normalizedReview = {
      ...review,
      station: station ?? null,
    };
    // Rows arrive newest first; do not replace a current result with an old row.
    if (!reviewMap.has(stationId)) reviewMap.set(stationId, normalizedReview);
    if (station?.code && !reviewByCode.has(station.code)) reviewByCode.set(station.code, normalizedReview);
    if (!packageStations.some((item) => item.id === stationId || (station?.code && item.code === station.code))) {
      packageStations.push({ id: stationId, name: station?.name ?? "방송국", code: station?.code ?? null });
    }
  });

  const initialStationReviews = packageStations.map((station) => {
    const review = (station.id ? reviewMap.get(station.id) : null) ??
      (station.code ? reviewByCode.get(station.code) : null);
    const trackResults = review
      ? normalizeTrackResults(review.track_results, resolvedSubmission.album_tracks)
      : null;
    return {
      id: review?.id ?? `placeholder-${submissionId}-${station.code ?? station.id}`,
      status: review?.status ?? "NOT_SENT",
      result_note: review?.result_note ?? null,
      age_rating: review?.age_rating ?? null,
      track_results: trackResults,
      updated_at: review?.updated_at ?? resolvedSubmission.updated_at,
      station: {
        id: review?.station_id || station.id || "",
        name: station.name,
        code: station.code,
        logo_url: getStationLogoPath(station),
      },
    };
  });

  return (
    <SubmissionDetailClient
      submissionId={submissionId}
      initialSubmission={initialSubmission as unknown as SubmissionDetailClientProps["initialSubmission"]}
      initialStationReviews={initialStationReviews}
      initialFiles={related.files.data ?? []}
      initialDataComplete={!related.files.error && !related.reviews.error}
      enableRealtime={!hasGuestPaymentResultGrant}
      refreshIntervalMs={hasGuestPaymentResultGrant ? 10000 : undefined}
      paymentState={paymentState}
      resultsOnly={resolvedSearchParams.view === "archive-result"}
    />
  );
}
