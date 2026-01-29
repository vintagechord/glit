import Image from "next/image";
import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { ConfirmForm } from "@/components/admin/confirm-form";
import { deleteArtistFormAction } from "@/features/admin/actions";

export const metadata = {
  title: "아티스트 관리",
};

export const dynamic = "force-dynamic";

type ArtistRow = {
  id: string;
  name: string;
  thumbnail_url: string | null;
  submissions?: Array<{ id: string; created_at: string }>;
};

export default async function AdminArtistsPage({
  searchParams,
}: {
  searchParams: { q?: string | null; sort?: string | null; page?: string | null };
}) {
  const admin = createAdminClient();
  const pageSize = 30;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const offset = (page - 1) * pageSize;

  let query = admin
    .from("artists")
    .select("id, name, thumbnail_url, submissions:submissions ( id, created_at )", {
      count: "exact",
    })
    .range(offset, offset + pageSize - 1);

  if (searchParams.q) {
    query = query.ilike("name", `%${searchParams.q}%`);
  }
  if (searchParams.sort === "name") {
    query = query.order("name", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error, count } = await query;
  const artists = (data ?? []) as ArtistRow[];
  const total = count ?? artists.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            관리자
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            아티스트 관리
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            심의 접수에 등장한 아티스트를 관리합니다.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          아티스트 정보를 불러올 수 없습니다. ({error.message})
        </div>
      )}

      <form className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <input
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="아티스트명 검색"
          className="min-w-[200px] rounded-2xl border border-border/70 bg-background px-4 py-2"
        />
        <select
          name="sort"
          defaultValue={searchParams.sort ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-3 py-2"
        >
          <option value="">최근 업데이트순</option>
          <option value="name">이름순</option>
        </select>
        <button
          type="submit"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
        >
          검색
        </button>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-[800px] w-full rounded-[24px] border border-border/60 bg-card/80 text-left text-sm shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <thead className="border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">썸네일</th>
              <th className="px-4 py-3 font-semibold">아티스트명</th>
              <th className="px-4 py-3 font-semibold">접수 건수</th>
              <th className="px-4 py-3 font-semibold">최근 접수일</th>
              <th className="px-4 py-3 font-semibold text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {artists.map((artist) => {
              const count = artist.submissions?.length ?? 0;
              const recent = artist.submissions
                ?.map((s) => s.created_at)
                ?.sort()
                ?.at(-1);
              return (
                <tr
                  key={artist.id}
                  className="hover:bg-background/60"
                >
                  <td className="px-4 py-3">
                    {artist.thumbnail_url ? (
                      <div className="relative h-12 w-12 overflow-hidden rounded-xl">
                        <Image
                          src={artist.thumbnail_url}
                          alt={artist.name}
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-sm font-semibold text-emerald-900">
                        {(artist.name || "A").charAt(0).toUpperCase()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <Link
                      href={`/admin/artists/${artist.id}`}
                      className="font-semibold hover:underline"
                    >
                      {artist.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {recent ? formatDate(recent) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ConfirmForm
                      action={deleteArtistFormAction}
                      message="해당 아티스트를 삭제하시겠습니까?"
                      className="inline"
                    >
                      <input type="hidden" name="id" value={artist.id} />
                      <input type="hidden" name="redirectTo" value="/admin/artists" />
                      <button
                        type="submit"
                        className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-rose-600 transition hover:border-rose-500 hover:text-rose-700"
                      >
                        삭제
                      </button>
                    </ConfirmForm>
                  </td>
                </tr>
              );
            })}
            {artists.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  등록된 아티스트가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <div>
          총 {total.toLocaleString()}명 · 페이지 {page} / {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={{
              pathname: "/admin/artists",
              query: { ...searchParams, page: Math.max(1, page - 1) },
            }}
            className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground transition hover:border-foreground aria-disabled:opacity-40"
            aria-disabled={page <= 1}
          >
            이전
          </Link>
          <Link
            href={{
              pathname: "/admin/artists",
              query: { ...searchParams, page: Math.min(totalPages, page + 1) },
            }}
            className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground transition hover:border-foreground aria-disabled:opacity-40"
            aria-disabled={page >= totalPages}
          >
            다음
          </Link>
        </div>
      </div>
    </div>
  );
}
