import Image from "next/image";
import Link from "next/link";

import { ConfirmForm } from "@/components/admin/confirm-form";
import { SelectAllCheckbox } from "@/components/admin/select-all-checkbox";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteArtistFormAction,
  deleteArtistsFormAction,
} from "@/features/admin/actions";

export const metadata = {
  title: "아티스트 관리",
};

export const dynamic = "force-dynamic";

type ArtistRow = {
  id: string;
  name: string;
  thumbnail_url: string | null;
};

type SearchParamsInput = {
  q?: string | string[];
  sort?: string | string[];
  page?: string | string[];
};

const pageSize = 30;

const toSingle = (value?: string | string[]) => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

export default async function AdminArtistsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const admin = createAdminClient();
  const resolvedSearchParams = await searchParams;
  const q = toSingle(resolvedSearchParams.q).trim();
  const sort = toSingle(resolvedSearchParams.sort) === "name" ? "name" : "";
  const pageParam = Number(toSingle(resolvedSearchParams.page) || "1");
  const requestedPage =
    Number.isFinite(pageParam) && pageParam > 1 ? Math.floor(pageParam) : 1;

  const fetchArtistsPage = async (targetPage: number) => {
    let query = admin
      .from("artists")
      .select("id, name, thumbnail_url", { count: "exact" });

    if (q) {
      query = query.ilike("name", `%${q}%`);
    }
    query =
      sort === "name"
        ? query.order("name", { ascending: true })
        : query.order("updated_at", { ascending: false });

    return query.range((targetPage - 1) * pageSize, targetPage * pageSize - 1);
  };

  const firstResult = await fetchArtistsPage(requestedPage);
  let artists = (firstResult.data ?? []) as ArtistRow[];
  let queryError = firstResult.error;
  const total = firstResult.count ?? artists.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

  if (!queryError && requestedPage !== page) {
    const corrected = await fetchArtistsPage(page);
    artists = (corrected.data ?? []) as ArtistRow[];
    queryError = corrected.error ?? queryError;
  }

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (q) {
      params.set("q", q);
    }
    if (sort) {
      params.set("sort", sort);
    }
    if (targetPage > 1) {
      params.set("page", String(targetPage));
    }
    const query = params.toString();
    return query ? `/admin/artists?${query}` : "/admin/artists";
  };

  const statsByArtistId = new Map<string, { count: number; recent: string | null }>();
  const applyStat = (artistId: string, createdAt?: string | null) => {
    const current = statsByArtistId.get(artistId) ?? { count: 0, recent: null };
    current.count += 1;
    if (createdAt && (!current.recent || createdAt > current.recent)) {
      current.recent = createdAt;
    }
    statsByArtistId.set(artistId, current);
  };

  let statsError: string | null = null;
  if (artists.length > 0) {
    const artistIds = artists.map((artist) => artist.id);
    const countResult = await admin
      .from("submissions")
      .select("artist_id, artist_name, created_at")
      .in("artist_id", artistIds);

    if (!countResult.error) {
      (countResult.data ?? []).forEach((row) => {
        if (typeof row.artist_id === "string") {
          applyStat(row.artist_id, row.created_at);
        }
      });
    } else if (countResult.error.code === "42703") {
      const artistNameToId = new Map(
        artists.map((artist) => [artist.name, artist.id] as const),
      );
      const fallback = await admin
        .from("submissions")
        .select("artist_name, created_at")
        .in("artist_name", artists.map((artist) => artist.name));

      if (fallback.error) {
        statsError = `접수 통계 집계에 실패했습니다. (${fallback.error.message})`;
      } else {
        (fallback.data ?? []).forEach((row) => {
          if (!row.artist_name) return;
          const artistId = artistNameToId.get(row.artist_name);
          if (artistId) {
            applyStat(artistId, row.created_at);
          }
        });
      }
    } else {
      statsError = `접수 통계 집계에 실패했습니다. (${countResult.error.message})`;
    }
  }

  const currentListHref = buildPageHref(page);

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

      {queryError && (
        <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          아티스트 정보를 불러올 수 없습니다. ({queryError.message})
        </div>
      )}
      {statsError && (
        <div className="mt-4 rounded-2xl border border-[#f6d64a] bg-[#f6d64a] px-4 py-3 text-sm text-black">
          {statsError}
        </div>
      )}

      <form className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <input
          name="q"
          defaultValue={q}
          placeholder="아티스트명 검색"
          className="min-w-[200px] rounded-2xl border border-border/70 bg-background px-4 py-2"
        />
        <select
          name="sort"
          defaultValue={sort}
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

      <ConfirmForm
        id="bulk-delete-form"
        action={deleteArtistsFormAction}
        message="선택한 아티스트를 삭제하시겠습니까?"
        className="mt-4 flex items-center justify-between rounded-2xl border border-border/60 bg-card/70 px-4 py-3"
      >
        <input type="hidden" name="redirectTo" value={currentListHref} />
        <p className="text-xs text-muted-foreground">
          체크한 아티스트를 한 번에 삭제합니다.
        </p>
        <button
          type="submit"
          className="rounded-full border border-rose-200/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-rose-600 transition hover:border-rose-500 hover:text-rose-700"
        >
          선택 삭제
        </button>
      </ConfirmForm>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-[900px] w-full rounded-[24px] border border-border/60 bg-card/80 text-center text-sm shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <thead className="border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <tr>
              <th className="w-14 px-4 py-3 font-semibold">
                <div className="flex items-center justify-center">
                  <SelectAllCheckbox formId="bulk-delete-form" />
                </div>
              </th>
              <th className="px-4 py-3 font-semibold">썸네일</th>
              <th className="px-4 py-3 font-semibold">아티스트명</th>
              <th className="px-4 py-3 font-semibold">접수 건수</th>
              <th className="px-4 py-3 font-semibold">최근 접수일</th>
              <th className="px-4 py-3 font-semibold">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {artists.map((artist) => {
              const stats = statsByArtistId.get(artist.id) ?? {
                count: 0,
                recent: null,
              };
              return (
                <tr key={artist.id} className="hover:bg-background/60">
                  <td className="px-4 py-3 align-middle">
                    <input
                      type="checkbox"
                      name="ids"
                      value={artist.id}
                      form="bulk-delete-form"
                      className="h-4 w-4 accent-foreground"
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {artist.thumbnail_url ? (
                      <div className="relative mx-auto h-12 w-12 overflow-hidden rounded-xl">
                        <Image
                          src={artist.thumbnail_url}
                          alt={artist.name}
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-sm font-semibold text-emerald-900">
                        {(artist.name || "A").charAt(0).toUpperCase()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle text-foreground">
                    <Link
                      href={`/admin/artists/${artist.id}`}
                      className="font-semibold hover:underline"
                    >
                      {artist.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    {stats.count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    {stats.recent ? formatDate(stats.recent) : "-"}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-center gap-2">
                      <Link
                        href={`/admin/artists/${artist.id}`}
                        className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground transition hover:border-foreground"
                      >
                        상세
                      </Link>
                      <ConfirmForm
                        action={deleteArtistFormAction}
                        message="해당 아티스트를 삭제하시겠습니까?"
                        className="inline"
                      >
                        <input type="hidden" name="id" value={artist.id} />
                        <input type="hidden" name="redirectTo" value={currentListHref} />
                        <button
                          type="submit"
                          className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-rose-600 transition hover:border-rose-500 hover:text-rose-700"
                        >
                          삭제
                        </button>
                      </ConfirmForm>
                    </div>
                  </td>
                </tr>
              );
            })}
            {artists.length === 0 && (
              <tr>
                <td
                  colSpan={6}
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
          {page > 1 ? (
            <Link
              href={buildPageHref(page - 1)}
              className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground transition hover:border-foreground"
            >
              이전
            </Link>
          ) : (
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
              이전
            </span>
          )}
          {page < totalPages ? (
            <Link
              href={buildPageHref(page + 1)}
              className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground transition hover:border-foreground"
            >
              다음
            </Link>
          ) : (
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
              다음
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
