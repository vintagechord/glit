import Image from "next/image";
import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { updateArtistAction } from "@/features/admin/actions";

export const metadata = {
  title: "아티스트 상세",
};

export const dynamic = "force-dynamic";

export default async function AdminArtistDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: { id?: string | string[] };
}) {
  // Next 16: params가 Promise로 전달되므로 먼저 언랩한다.
  const { id } = await params;
  const paramId = id ?? "";
  const searchId = Array.isArray(searchParams?.id)
    ? searchParams?.id?.[0]
    : searchParams?.id ?? "";
  const artistId = paramId || searchId;

  console.log("[Admin ArtistDetail] incoming", {
    paramId,
    searchId,
  });

  if (!artistId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          관리자
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">아티스트 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          잘못된 아티스트 ID입니다.
        </p>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <p>요청 ID: {artistId || "비어 있음"}</p>
          <p>params.id: {paramId || "없음"} / searchParams.id: {searchId || "없음"}</p>
        </div>
        <div className="mt-3">
          <Link
            href="/admin/artists"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data: artist, error } = await admin
    .from("artists")
    .select(
      "id, name, thumbnail_url, created_at, updated_at, submissions:submissions ( id, title, status, type, artist_name, user_id, created_at, updated_at )",
    )
    .eq("id", artistId)
    .maybeSingle();

  if (error || !artist) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          관리자
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">아티스트 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          아티스트 정보를 불러올 수 없습니다. ({error?.message ?? "not found"})
        </p>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          요청 ID: {artistId}
        </div>
        <div className="mt-3">
          <Link
            href="/admin/artists"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const submissions = artist.submissions ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {artist.thumbnail_url ? (
            <div className="relative h-16 w-16 overflow-hidden rounded-2xl">
              <Image
                src={artist.thumbnail_url}
                alt={artist.name}
                fill
                sizes="64px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-lg font-bold text-emerald-900">
              {(artist.name || "A").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              관리자
            </p>
            <h1 className="font-display mt-1 text-3xl text-foreground">
              {artist.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              생성: {formatDate(artist.created_at)} · 수정: {formatDate(artist.updated_at)}
            </p>
          </div>
        </div>
        <Link
          href="/admin/artists"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          목록으로 돌아가기
        </Link>
      </div>

      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          기본 정보
        </p>
        <form action={updateArtistAction} className="mt-4 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="artistId" value={artist.id} />
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              아티스트명
            </label>
            <input
              name="name"
              defaultValue={artist.name}
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              NOTE: 이름 변경 시 모든 연결된 심의는 동일 아티스트를 바라보지만, 표시 텍스트는 바뀔 수 있습니다.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              썸네일 URL
            </label>
            <input
              name="thumbnailUrl"
              defaultValue={artist.thumbnail_url ?? ""}
              placeholder="https://..."
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              TODO: 스토리지 업로드 컴포넌트로 교체하면 자동 업로드/삭제 가능.
            </p>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
            >
              저장
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          연관 심의 목록
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[700px] w-full rounded-[24px] border border-border/60 bg-background/80 text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">제목</th>
                <th className="px-4 py-3 font-semibold">유형</th>
                <th className="px-4 py-3 font-semibold">상태</th>
                <th className="px-4 py-3 font-semibold">접수일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {submissions.map((s) => (
                <tr key={s.id} className="hover:bg-background/60">
                  <td className="px-4 py-3 text-foreground">
                    <Link
                      href={`/admin/submissions/detail?id=${s.id}`}
                      className="font-semibold hover:underline"
                    >
                      {s.title || "제목 미입력"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(s.created_at)}
                  </td>
                </tr>
              ))}
              {submissions.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    연관된 심의가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
