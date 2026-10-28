import { createHash, randomUUID } from "node:crypto";
import { matchArtistCandidate } from "./artist-search";
import { MusicProviderError } from "./musicbrainz";
import type { ArtistCandidate, ProviderSupport } from "./providers";

const sourceOrder = ["melon", "genie", "spotify", "apple", "youtube"] as const;
export type AutomaticArtistProvider = typeof sourceOrder[number];
export type ArtistSearchProviderResult = {
  provider: AutomaticArtistProvider; name: string;
  status: "success" | "empty" | "configuration_required" | "temporary_error" | "forbidden" | "unsupported";
  count: number; message?: string;
};
type SourceResult = { items: ArtistCandidate[]; scopeNote?: string };
type SourceSearch = (provider: AutomaticArtistProvider, query: string, signal: AbortSignal) => Promise<SourceResult>;
type Snapshot = { id: string; items: ArtistCandidate[]; providerResults: ArtistSearchProviderResult[]; checkedAt: string };
const scopeNote = "온사이트가 연결된 음악 서비스를 함께 검색합니다. 서비스별 첫 검색 결과를 모아 표시하며, 같은 이름도 프로필을 확인한 뒤 선택해주세요.";

/** Public search results only: never infer cross-service identity from a name. */
function rankedCandidates(items: ArtistCandidate[], query: string) {
  const unique = new Map<string, ArtistCandidate>();
  for (const item of items) {
    const key = JSON.stringify([item.provider, item.externalId]);
    if (!unique.has(key)) unique.set(key, item);
  }
  // Provider aliases may differ from the query, so retain validated provider
  // matches after exact/prefix matches instead of silently removing them.
  return [...unique.values()].map((candidate, index) => ({ candidate, index, score: matchArtistCandidate(candidate, query)?.score ?? 0 }))
    .sort((left, right) => right.score - left.score || left.index - right.index).map(item => item.candidate);
}

/**
 * Bound slow providers independently, share concurrent identical public searches,
 * and paginate one short-lived snapshot instead of re-querying every provider.
 * The map contains hashed queries and public responses, with no member identity.
 */
export function createAutomaticArtistSearch(options: { timeoutMs?: number; now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
  const cache = new Map<string, { value: Snapshot; expiresAt: number; retryable: boolean }>();
  const snapshots = new Map<string, { key: string; value: Snapshot; expiresAt: number }>();
  const inFlight = new Map<string, Promise<Snapshot>>();
  const now = options.now ?? Date.now;
  const capacity = options.maxEntries ?? 128;
  const cap = <T>(map: Map<string, T>) => { while (map.size > capacity) map.delete(map.keys().next().value!); };

  return async function search(query: string, offset: number, providers: ProviderSupport[], searchSource: SourceSearch, searchId?: string | null) {
    const sources = sourceOrder.map(provider => providers.find(item => item.id === provider)).filter((item): item is ProviderSupport & { id: AutomaticArtistProvider } => !!item);
    const key = createHash("sha256").update(JSON.stringify([query.trim().normalize("NFC").toLowerCase(), sources.map(({ id, status }) => [id, status])])).digest("hex");
    for (const [storedKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(storedKey);
    for (const [storedId, entry] of snapshots) if (entry.expiresAt <= now()) snapshots.delete(storedId);
    const cached = cache.get(key);
    const requested = searchId ? snapshots.get(searchId) : undefined;
    if (searchId && (!requested || requested.key !== key)) return {
      items: [], total: 0, nextOffset: null, queryStatus: "temporary_error", searchId: null, providerResults: [], scopeNote,
      message: "검색 결과의 유효 시간이 지났습니다. 검색 버튼을 눌러 다시 찾아주세요.",
    };
    let snapshot = requested?.value ?? (cached && (offset > 0 || !cached.retryable) ? cached.value : undefined);
    if (!snapshot) {
      let pending = inFlight.get(key);
      if (!pending) {
        pending = (async (): Promise<Snapshot> => {
          const outcomes = await Promise.all(sources.map(async source => {
            const base = { provider: source.id, name: source.name, count: 0 };
            if (source.status !== "available") return { items: [], result: { ...base, status: source.status === "configuration_required" ? "configuration_required" : source.status === "permission_required" ? "forbidden" : "unsupported", message: source.message } as ArtistSearchProviderResult };
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  controller.abort();
                  reject(new MusicProviderError("temporary_error", `${source.name} 검색 시간이 초과되었습니다. 다시 검색해주세요.`));
                }, options.timeoutMs ?? 17_000);
              });
              const found = await Promise.race([searchSource(source.id, query, controller.signal), timeout]);
              const items = found.items.filter(item => item.provider === source.id).slice(0, 20);
              return { items, result: { ...base, status: items.length ? "success" : "empty", count: items.length } as ArtistSearchProviderResult };
            } catch (error) {
              const code = error instanceof MusicProviderError ? error.code : "temporary_error";
              const status: ArtistSearchProviderResult["status"] = code === "not_found" ? "empty" : code === "configuration_required" ? "configuration_required" : code === "permission_required" ? "forbidden" : "temporary_error";
              return { items: [], result: { ...base, status, ...(status === "empty" ? {} : { message: `${source.name} 검색을 지금 이용할 수 없습니다. 잠시 후 다시 검색하거나 공식 사이트에서 확인해주세요.` }) } };
            } finally { if (timer) clearTimeout(timer); }
          }));
          return { id: randomUUID(), items: rankedCandidates(outcomes.flatMap(item => item.items), query), providerResults: outcomes.map(item => item.result), checkedAt: new Date(now()).toISOString() };
        })();
        inFlight.set(key, pending); cap(inFlight);
      }
      try {
        snapshot = await pending;
        cache.set(key, { value: snapshot, expiresAt: now() + (options.ttlMs ?? 60_000), retryable: snapshot.providerResults.some(item => ["temporary_error", "forbidden"].includes(item.status)) });
        snapshots.set(snapshot.id, { key, value: snapshot, expiresAt: now() + 10 * 60_000 }); cap(snapshots);
        cap(cache);
      } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
    }
    const items = snapshot.items.slice(offset, offset + 20);
    const available = snapshot.providerResults.some(item => item.status === "success" || item.status === "empty");
    const failed = snapshot.providerResults.filter(item => item.status === "temporary_error" || item.status === "forbidden");
    return {
      items, total: snapshot.items.length, nextOffset: offset + items.length < snapshot.items.length ? offset + items.length : null,
      providerResults: snapshot.providerResults, checkedAt: snapshot.checkedAt, scopeNote, searchId: snapshot.id,
      queryStatus: snapshot.items.length ? "success" : available ? "no_results" : "temporary_error",
      ...(!available ? { message: "음악 서비스 검색을 완료하지 못했습니다. 잠시 후 다시 검색하거나 아티스트 링크로 추가해주세요." } : failed.length ? { message: `${failed.map(item => item.name).join("·")} 검색이 지연되어 확인한 서비스의 결과를 먼저 표시합니다. 다시 검색하면 재시도합니다.` } : {}),
    };
  };
}

export const searchAutomaticArtists = createAutomaticArtistSearch();
