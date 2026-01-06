import Link from "next/link";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";

export const metadata = {
  title: "심의 상세",
};

export default async function SubmissionDetailPage({
  params,
  searchParams,
}: {
  params?: { id?: string };
  searchParams?: { id?: string | string[] };
}) {
  const paramId = params?.id;
  const queryId = Array.isArray(searchParams?.id)
    ? searchParams?.id?.[0]
    : searchParams?.id;
  const rawId = typeof paramId === "string" ? paramId : queryId ?? "";
  const submissionId = rawId.trim();

  // Debug to catch unexpected ID shapes during navigation
  console.log("[SubmissionDetailPage] params:", params, "searchParams:", searchParams, "rawId:", rawId);

  if (!submissionId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Submission
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">유효하지 않은 접수 ID입니다.</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          URL에 접수 ID가 포함되어 있는지 확인해주세요.
        </p>
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
  const baseSelect =
    "id, user_id, title, artist_name, type, status, payment_status, amount_krw, created_at, updated_at, package:packages ( name, station_count, price_krw )";
  const fullSelect =
    "id, user_id, title, artist_name, type, status, payment_status, payment_method, amount_krw, mv_rating_file_path, created_at, updated_at, package:packages ( name, station_count, price_krw )";

  const fetchSubmission = async (
    client: typeof supabase,
    column: "id" | "guest_token",
    value: string,
  ) => {
    const { data, error } = await client
      .from("submissions")
      .select(fullSelect)
      .eq(column, value)
      .maybeSingle();

    if (!error) {
      return data;
    }

    if (error.code === "PGRST204") {
      const { data: fallbackData } = await client
        .from("submissions")
        .select(baseSelect)
        .eq(column, value)
        .maybeSingle();
      return fallbackData ?? null;
    }

    return null;
  };

  const admin = createAdminClient();
  const adminSubmission = await fetchSubmission(admin, "id", submissionId);
  console.log("[SubmissionDetailPage] admin lookup", {
    submissionId,
    found: Boolean(adminSubmission),
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

  let resolvedSubmission = await fetchSubmission(supabase, "id", submissionId);
  console.log("[SubmissionDetailPage] user lookup", {
    submissionId,
    found: Boolean(resolvedSubmission),
  });

  if (!resolvedSubmission) {
    resolvedSubmission = adminSubmission;
  }
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

  const stationReviewsClient = user ? supabase : admin;

  const { data: events } = await supabase
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", resolvedSubmission.id)
    .order("created_at", { ascending: false });

  const { data: stationReviews } = await stationReviewsClient
    .from("station_reviews")
    .select(
      "id, status, result_note, updated_at, station:stations ( id, name, code )",
    )
    .eq("submission_id", resolvedSubmission.id)
    .order("updated_at", { ascending: false });
  const normalizedStationReviews =
    stationReviews?.map((review) => ({
      ...review,
      station: Array.isArray(review.station) ? review.station[0] : review.station,
    })) ?? [];

  const filesClient = user ? supabase : admin;
  const { data: submissionFiles } = await filesClient
    .from("submission_files")
    .select("id, kind, file_path, original_name, mime, size, created_at")
    .eq("submission_id", resolvedSubmission.id)
    .order("created_at", { ascending: false });

  const isOwner = Boolean(user && resolvedSubmission.user_id === user.id);
  let creditBalance = 0;
  let promotion = null;

  if (isOwner && user) {
    const { data: creditRow } = await supabase
      .from("karaoke_credits")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();
    creditBalance = creditRow?.balance ?? 0;

    const { data: promotionRow } = await supabase
      .from("karaoke_promotions")
      .select(
        "id, status, credits_balance, credits_required, tj_enabled, ky_enabled, reference_url",
      )
      .eq("submission_id", resolvedSubmission.id)
      .maybeSingle();
    promotion = promotionRow ?? null;
  }

  return (
    <SubmissionDetailClient
      submissionId={params.id}
      initialSubmission={{ ...resolvedSubmission, package: packageInfo ?? null }}
      initialEvents={events ?? []}
      initialStationReviews={normalizedStationReviews}
      initialFiles={submissionFiles ?? []}
      creditBalance={creditBalance}
      promotion={promotion}
      canManagePromotion={isOwner}
    />
  );
}
