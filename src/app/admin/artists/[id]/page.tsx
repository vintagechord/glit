import Image from "next/image";
import Link from "next/link";

import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { updateArtistAction } from "@/features/admin/actions";
import { ArtistThumbnailUploader } from "@/components/admin/artist-thumbnail-uploader";
import { AdminSaveToast } from "@/components/admin/save-toast";

export const metadata = {
  title: "아티스트 상세",
};

export const dynamic = "force-dynamic";

export default async function AdminArtistDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ id?: string | string[]; saved?: string | string[] }>;
}) {
  await requireAdminPage();
  // Next 16: params가 Promise로 전달되므로 먼저 언랩한다.
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const paramId = id ?? "";
  const searchId = Array.isArray(resolvedSearchParams?.id)
    ? resolvedSearchParams?.id?.[0]
    : resolvedSearchParams?.id ?? "";
  const savedFlag = Array.isArray(resolvedSearchParams?.saved)
    ? resolvedSearchParams?.saved[0]
    : resolvedSearchParams?.saved;
  const artistId = paramId || searchId;

  if (!artistId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display text-2xl text-foreground">아티스트 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          잘못된 아티스트 ID입니다.
        </p>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            요청 정보
          </summary>
          <div className="mt-2 space-y-1 rounded-2xl border border-border/60 bg-background px-4 py-3">
            <p>요청 ID: {artistId || "비어 있음"}</p>
            <p>경로 ID: {paramId || "없음"}</p>
            <p>검색 ID: {searchId || "없음"}</p>
          </div>
        </details>
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
    .select("id, name, thumbnail_url, created_at, updated_at")
    .eq("id", artistId)
    .maybeSingle();

  if (error || !artist) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display text-2xl text-foreground">아티스트 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          아티스트 정보를 불러올 수 없습니다.
        </p>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            오류 상세
          </summary>
          <div className="mt-2 space-y-1 rounded-2xl border border-border/60 bg-background px-4 py-3">
            <p>요청 ID: {artistId}</p>
            <p>{error?.message ?? "not found"}</p>
          </div>
        </details>
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

  let submissions = [] as Array<{
    id: string;
    title: string | null;
    status: string | null;
    type: string | null;
    artist_name: string | null;
    user_id: string | null;
    created_at: string;
    updated_at: string | null;
  }>;
  let submissionsError: string | null = null;

  const byArtistId = await admin
    .from("submissions")
    .select("id, title, status, type, artist_name, user_id, created_at, updated_at")
    .eq("artist_id", artistId)
    .order("updated_at", { ascending: false });

  if (!byArtistId.error) {
    submissions = byArtistId.data ?? [];
  } else if (byArtistId.error.code === "42703") {
    const fallback = await admin
      .from("submissions")
      .select("id, title, status, type, artist_name, user_id, created_at, updated_at")
      .eq("artist_name", artist.name)
      .order("updated_at", { ascending: false });
    if (fallback.error) {
      submissionsError = fallback.error.message;
    } else {
      submissions = fallback.data ?? [];
    }
  } else {
    submissionsError = byArtistId.error.message;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 space-y-6">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {artist.thumbnail_url ? (
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl">
              <Image
                src={artist.thumbnail_url}
                alt={artist.name}
                fill
                sizes="64px"
                unoptimized
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-lg font-bold text-emerald-900">
              {(artist.name || "A").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display break-words text-2xl text-foreground sm:text-3xl">
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
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer font-semibold text-foreground">
                이름 변경 안내
              </summary>
              <p className="mt-1 leading-5">
                연결된 심의는 유지되지만 화면의 아티스트 표시는 변경될 수 있습니다.
              </p>
            </details>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              썸네일 이미지
            </label>
            <ArtistThumbnailUploader initialUrl={artist.thumbnail_url ?? ""} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black"
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
        {submissionsError ? (
          <div className="mt-3 rounded-2xl border border-[#f6d64a] bg-[#f6d64a] px-4 py-3 text-sm text-black">
            <p className="font-semibold">연관 심의를 불러오지 못했습니다.</p>
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer font-semibold">오류 상세</summary>
              <p className="mt-1 break-words">{submissionsError}</p>
            </details>
          </div>
        ) : null}
        <div
          className="mt-4 overflow-x-auto"
          role="region"
          aria-label="아티스트 관련 심의 목록"
          tabIndex={0}
        >
          <table className="min-w-[700px] w-full rounded-[24px] border border-border/60 bg-background/80 text-left text-sm">
            <caption className="sr-only">아티스트 관련 심의 접수 목록</caption>
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
