import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

import {
  DashboardShell,
  type DashboardTab,
  statusDashboardTabs,
} from "@/components/dashboard/dashboard-shell";
import { formatShortDate } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "아티스트 상세",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const typeLabels: Record<string, string> = {
  ALBUM: "음반",
  MV_DISTRIBUTION: "MV · 온라인",
  MV_BROADCAST: "MV · 방송",
};

const statusLabels: Record<string, string> = {
  DRAFT: "임시 저장",
  SUBMITTED: "접수 완료",
  PRE_REVIEW: "사전 검토",
  WAITING_PAYMENT: "결제 대기",
  IN_PROGRESS: "심의 진행",
  RESULT_READY: "결과 전달",
  COMPLETED: "완료",
};

type SubmissionRow = {
  id: string;
  title: string | null;
  artist_name?: string | null;
  status: string;
  type: string;
  payment_status?: string | null;
  created_at: string;
  updated_at: string | null;
  user_deleted_at?: string | null;
  package?:
    | Array<{ name?: string | null; station_count?: number | null }>
    | { name?: string | null; station_count?: number | null }
    | null;
};

const isMissingUserDeletedAt = (error?: { code?: string; message?: string }) =>
  Boolean(
    error &&
      (error.code === "42703" ||
        error.message?.toLowerCase().includes("user_deleted_at")),
  );

export async function DashboardArtistDetailPageView({
  params,
  localePrefix = "",
  tabs = statusDashboardTabs,
}: {
  params: Promise<{ id: string }>;
  localePrefix?: "" | "/en";
  tabs?: DashboardTab[];
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    const nextPath = `${localePrefix}/dashboard/artists/${encodeURIComponent(id)}`;
    redirect(`${localePrefix}/login?next=${encodeURIComponent(nextPath)}`);
  }

  const uuidPattern =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  const rawId = id?.trim();
  const artistId = rawId && uuidPattern.test(rawId) ? rawId : "";

  if (!artistId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display mt-2 text-2xl text-foreground">
          잘못된 아티스트 정보입니다.
        </h1>
        <div className="mt-3">
          <Link
            href={`${localePrefix}/dashboard/history`}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            심의 내역
          </Link>
        </div>
      </div>
    );
  }

  // Fetch artist via admin client to avoid permission gaps
  const admin = createAdminClient();
  const { data: artist } = await admin
    .from("artists")
    .select("id, name, thumbnail_url")
    .eq("id", artistId)
    .maybeSingle();

  if (!artist) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display mt-2 text-2xl text-foreground">아티스트 정보를 찾을 수 없습니다.</h1>
        <div className="mt-3">
          <Link
            href={`${localePrefix}/dashboard/history`}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            심의 내역
          </Link>
        </div>
      </div>
    );
  }

  const runSubmissionQuery = (includeUserVisibility = true) => {
    let query = supabase
      .from("submissions")
      .select(
        "id, title, artist_name, status, type, payment_status, created_at, updated_at, user_deleted_at, package:packages ( name, station_count )",
      )
      .eq("user_id", user.id)
      .eq("artist_id", artistId)
      .eq("payment_status", "PAID");
    if (includeUserVisibility) {
      query = query.is("user_deleted_at", null);
    }
    return query.order("created_at", { ascending: false });
  };

  const { data: submissionData, error: submissionError } =
    await runSubmissionQuery();
  let submissions: unknown[] | null = submissionData;
  if (submissionError && isMissingUserDeletedAt(submissionError)) {
    const { data: legacyData, error: legacyError } = await supabase
      .from("submissions")
      .select(
        "id, title, artist_name, status, type, payment_status, created_at, updated_at, package:packages ( name, station_count )",
      )
      .eq("user_id", user.id)
      .eq("artist_id", artistId)
      .eq("payment_status", "PAID")
      .order("created_at", { ascending: false });
    if (legacyError) {
      console.error("[ArtistDetailPage] legacy submissions query failed", legacyError);
    }
    submissions = legacyData;
  } else if (submissionError) {
    console.error("[ArtistDetailPage] submissions query failed", submissionError);
    submissions = [];
  }

  const list = (submissions ?? []) as SubmissionRow[];
  const displayArtistName =
    list.find((item) => item.artist_name?.trim())?.artist_name?.trim() ||
    artist.name ||
    "아티스트 미입력";

  return (
    <DashboardShell
      title={displayArtistName}
      activeTab="history"
      tabs={tabs}
      contextLabel={localePrefix === "/en" ? "Status" : "진행상황"}
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-[28px] border border-border/60 bg-card/80 p-4">
          {artist.thumbnail_url ? (
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl">
              <Image
                src={artist.thumbnail_url}
                alt={artist.name ?? ""}
                fill
                sizes="56px"
                unoptimized
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-lg font-bold text-emerald-900">
              {(artist.name || "A").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-base font-semibold text-foreground">{displayArtistName}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-black text-muted-foreground">
              {list.length}건
            </span>
          </div>
        </div>

        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
            심의 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((submission) => (
              <Link
                key={submission.id}
                href={`${localePrefix}/dashboard/submissions/${encodeURIComponent(submission.id)}`}
                className="block rounded-2xl border border-border/60 bg-card/80 p-4 transition hover:border-foreground"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-muted-foreground">
                      {typeLabels[submission.type] ?? submission.type ?? "심의"}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground">
                      {submission.title || "제목 미입력"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {Array.isArray(submission.package)
                        ? submission.package[0]?.name ?? "-"
                        : submission.package?.name ?? "-"} ·{" "}
                      {formatShortDate(submission.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right text-xs">
                    <span className="rounded-full border border-border/70 px-3 py-1 font-semibold uppercase tracking-[0.2em] text-foreground">
                      {statusLabels[submission.status] ?? submission.status}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

export default async function DashboardArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return DashboardArtistDetailPageView({ params });
}
