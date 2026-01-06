import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  DashboardShell,
  statusDashboardTabs,
} from "@/components/dashboard/dashboard-shell";
import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "아티스트 상세",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const typeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "뮤직비디오 심의 (유통/온라인)",
  MV_BROADCAST: "뮤직비디오 심의 (TV 송출)",
};

const statusLabels: Record<string, string> = {
  DRAFT: "임시 저장",
  SUBMITTED: "접수 완료",
  PRE_REVIEW: "사전 검토",
  WAITING_PAYMENT: "결제대기",
  IN_PROGRESS: "심의 진행",
  RESULT_READY: "결과 확인",
  COMPLETED: "완료",
};

type SubmissionRow = {
  id: string;
  title: string | null;
  status: string;
  type: string;
  payment_status?: string | null;
  created_at: string;
  updated_at: string | null;
  package?:
    | Array<{ name?: string | null; station_count?: number | null }>
    | { name?: string | null; station_count?: number | null }
    | null;
};

export default async function DashboardArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const uuidPattern =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  const rawId = id?.trim();
  const artistId = rawId && uuidPattern.test(rawId) ? rawId : "";

  console.log("[Dashboard ArtistDetail] incoming", {
    params: { id },
    artistId,
  });

  if (!artistId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Artist
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">
          아티스트 ID가 전달되지 않았습니다.
        </h1>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          요청 ID: {artistId || "없음"}
        </div>
        <div className="mt-3">
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

  // Fetch artist via admin client to avoid permission gaps
  const admin = createAdminClient();
  const { data: artist } = await admin
    .from("artists")
    .select("id, name, thumbnail_url, created_at, updated_at")
    .eq("id", artistId)
    .maybeSingle();

  if (!artist) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Artist
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">아티스트 정보를 찾을 수 없습니다.</h1>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          요청 ID: {artistId}
        </div>
        <div className="mt-3">
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

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, title, status, type, payment_status, created_at, updated_at, package:packages ( name, station_count )",
    )
    .eq("user_id", user.id)
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false });

  const list = (submissions ?? []) as SubmissionRow[];

  return (
    <DashboardShell
      title={artist.name}
      description="해당 아티스트의 접수 내역을 확인합니다."
      activeTab="history"
      tabs={statusDashboardTabs}
      contextLabel="진행상황"
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
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-lg font-bold text-emerald-900">
              {(artist.name || "A").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="text-sm text-muted-foreground">
            <p className="text-base font-semibold text-foreground">{artist.name}</p>
            <p>생성: {formatDateTime(artist.created_at)}</p>
            <p>수정: {formatDateTime(artist.updated_at ?? artist.created_at)}</p>
          </div>
        </div>

        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
            해당 아티스트의 접수 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((submission) => (
              <Link
                key={submission.id}
                href={`/dashboard/submissions/${submission.id}`}
                className="block rounded-2xl border border-border/60 bg-card/80 p-4 transition hover:border-foreground"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {typeLabels[submission.type] ?? submission.type ?? "심의"}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground">
                      {submission.title || "제목 미입력"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      생성: {formatDateTime(submission.created_at)} · 업데이트:{" "}
                      {formatDateTime(submission.updated_at ?? submission.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      패키지:{" "}
                      {Array.isArray(submission.package)
                        ? submission.package[0]?.name ?? "-"
                        : submission.package?.name ?? "-"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right text-xs">
                    <span className="rounded-full border border-border/70 px-3 py-1 font-semibold uppercase tracking-[0.2em] text-foreground">
                      {statusLabels[submission.status] ?? submission.status}
                    </span>
                    <span className="rounded-full border border-border/70 px-3 py-1 font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      결제: {submission.payment_status ?? "-"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      상세 보기 →
                    </span>
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
