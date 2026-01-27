import type { PostgrestError } from "@supabase/supabase-js";
import Link from "next/link";
import type React from "react";

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

const lightSelect =
  "id, user_id, artist_id, title, artist_name, artist_name_kr, artist_name_en, type, status, payment_status, payment_method, amount_krw, created_at, updated_at, mv_rating, mv_desired_rating, mv_certificate_object_key, mv_certificate_filename, mv_certificate_mime_type, mv_certificate_size_bytes, mv_certificate_uploaded_at, package:packages ( name, station_count, price_krw )";

type SubmissionDetailClientProps = React.ComponentProps<typeof SubmissionDetailClient>;

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
  mv_rating?: string | null;
  mv_certificate_object_key?: string | null;
  mv_certificate_filename?: string | null;
  mv_certificate_mime_type?: string | null;
  mv_certificate_size_bytes?: number | null;
  mv_certificate_uploaded_at?: string | null;
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
        id?: string | null;
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
  const { data: isAdminRpc } = await supabase.rpc("is_admin");
  const isAdmin = isAdminRpc === true;

  const extractMissingColumn = (error: PostgrestError | null) => {
    const msg = error?.message ?? "";
    const match =
      msg.match(/column\\s+\"?([^\\s\\\"']+)\"?\\s+does not exist/i) ||
      msg.match(/column\\s+'?([^\\s\\\"']+)'?\\s+does not exist/i);
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

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error: err } = await client
        .from("submissions")
        .select(selectClause)
        .eq("id", submissionId)
        .maybeSingle();
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

  const resolvedSubmission = {
    ...(userSubmission ?? adminSubmission),
    mv_rating: (userSubmission ?? adminSubmission)?.mv_rating ?? (userSubmission ?? adminSubmission)?.mv_desired_rating ?? null,
  };
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

  return (
    <SubmissionDetailClient
      submissionId={submissionId}
      initialSubmission={initialSubmission as unknown as SubmissionDetailClientProps["initialSubmission"]}
      initialEvents={[]}
      initialStationReviews={[]}
      initialFiles={[]}
      isAdmin={isAdmin}
    />
  );
}
