import type { ArchiveData } from "@/lib/music-archive/model";
import type { ProviderSupport } from "@/lib/music-archive/providers";
import type { AgencyGuide } from "@/lib/music-archive/guides";

export type Library = { id: string; version: number; data: ArchiveData; archived_at?: string | null; updated_at?: string; summary?: { releaseCount: number; trackCount: number; needsCheck: number; inProgress: number; needsChanges: number; awaitingResult: number } };
export type SyncJob = { id: string; library_id: string; provider: string; status: string; cursor?: { providerCursor?: { phase?: string; offset?: number; pending?: string[]; total?: number }; releaseIds?: string[]; scopeNote?: string }; counts?: Record<string, number>; error_code?: string | null; error_message?: string | null; checked_at?: string | null; updated_at?: string; scope_note?: string };
export type Submission = { id: string; title: string; artist_name?: string; release_date?: string; status: string; created_at?: string; updated_at?: string; album_tracks?: { id: string; track_no: number; track_title: string }[]; station_reviews?: { id: string; status: string; result_note?: string | null; track_results_json?: unknown; updated_at?: string; station?: { name: string } | { name: string }[] }[]; submission_events?: { id: string; message?: string; note?: string; event_type?: string; created_at?: string }[] };
export type Evidence = { id: string; task_id: string; file_name: string; size_bytes: number; created_at: string };
export type ArchiveEvent = { id: string; action: string; before_version: number; after_version: number; created_at: string };
export type LibraryDetail = { library: Library; jobs: SyncJob[]; reviews: Submission[]; evidence: Evidence[]; events: ArchiveEvent[] };
export type ArchiveIndex = { libraries: Library[]; providers: ProviderSupport[]; guides: AgencyGuide[]; jobs: SyncJob[]; nextPage?: number | null; total?: number };
export const providerNames: Record<string, string> = { musicbrainz: "MusicBrainz", spotify: "Spotify", melon: "멜론", genie: "지니뮤직", bugs: "벅스", user: "사용자 입력", manual: "사용자 입력" };
export const supportLabels: Record<string, string> = { available: "자동 조회 가능", configuration_required: "서버 설정 필요", permission_required: "이용 허가 확인 필요", link_only: "링크 안내" };
export const jobLabels: Record<string, string> = { queued: "수집 대기", running: "수집 중", partial: "일부 수집 · 계속 가능", completed: "조회 범위 처리 완료", blocked: "설정/허가 확인 필요", failed: "일시 실패", cancelled: "중단됨" };
export const releaseLabels: Record<string, string> = { album: "앨범", ep: "EP", single: "싱글", other: "기타" };
export async function archiveRequest<T>(query: string = "", body?: unknown): Promise<T> {
  const response = await fetch(`/api/music-archive${query}`, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.error || "요청을 처리하지 못했습니다.") as Error & { status: number }; error.status = response.status; throw error; }
  return result as T;
}
