import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { archiveDatabaseError } from "./http";
import { searchAppleArtists } from "./apple";
import { normalizeArtistSearchText, getArtistInitials, isInitialConsonantQuery, rankArtistCandidates } from "./artist-search";
import type { ArtistCandidate } from "./providers";

type CatalogResult = { items: ArtistCandidate[]; total: number; nextOffset: number | null; checkedAt?: string; limited?: boolean; scopeNote?: string };
/** Public provider metadata only. No private artist names, submissions or owner IDs enter this index. */
export async function indexCatalogArtists(items: ArtistCandidate[], checkedAt: string) {
  if (!items.length) return;
  const { error } = await createAdminClient().from("music_archive_artist_index").upsert(items.filter(item => item.provider === "apple").map(item => ({
    provider: item.provider, external_id: item.externalId,
    normalized_name: normalizeArtistSearchText(item.name).slice(0, 500), normalized_alias: normalizeArtistSearchText(item.sortName).slice(0, 500),
    initials: getArtistInitials(item.name).slice(0, 500), alias_initials: getArtistInitials(item.sortName).slice(0, 500), payload: item, checked_at: checkedAt,
  })), { onConflict: "provider,external_id" });
  archiveDatabaseError(error);
}
export async function searchCatalogArtists(query: string, offset: number, acquirePermit: () => Promise<void>): Promise<CatalogResult> {
  const admin = createAdminClient();
  const normalized = normalizeArtistSearchText(query);
  if (isInitialConsonantQuery(query)) {
    const { data, error } = await admin.from("music_archive_artist_index").select("payload,checked_at").or(`initials.like.${getArtistInitials(query)}%,alias_initials.like.${getArtistInitials(query)}%`).order("checked_at", { ascending: false }).limit(200);
    archiveDatabaseError(error);
    const items = rankArtistCandidates((data ?? []).map(row => row.payload as ArtistCandidate), query, 20);
    return { items, total: items.length, nextOffset: null, scopeNote: "초성 제안은 확인된 아티스트 목록에서 찾습니다. 원하는 이름이 없으면 전체 이름으로 검색해주세요." };
  }
  const key = createHash("sha256").update(`apple:KR:${normalized}`).digest("hex");
  const { data: cached, error: cacheError } = await admin.from("music_archive_search_cache").select("payload").eq("query_key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
  archiveDatabaseError(cacheError);
  let result = cached?.payload as CatalogResult | undefined;
  if (!result) {
    result = await searchAppleArtists(query, { offset: 0, pageSize: 200, acquirePermit });
    await indexCatalogArtists(result.items, result.checkedAt ?? new Date().toISOString());
    const { error } = await admin.from("music_archive_search_cache").upsert({ query_key: key, payload: result, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
    archiveDatabaseError(error);
    // Bounded expiry cleanup: cached searches carry no member identity or raw query.
    await admin.from("music_archive_search_cache").delete().lt("expires_at", new Date(Date.now() - 86400_000).toISOString());
  }
  const items = result.items.slice(offset, offset + 20);
  return { ...result, items, nextOffset: offset + items.length < result.items.length ? offset + items.length : null };
}
