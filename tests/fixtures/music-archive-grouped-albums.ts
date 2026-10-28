import { applyArchiveCommand, createArchiveData } from "../../src/lib/music-archive/model";
import { mergeArchiveImports } from "../../src/lib/music-archive/import";
import type { ImportedRelease } from "../../src/lib/music-archive/providers";
import type { LibraryDetail } from "../../src/features/music-archive/types";

export const groupedLibraryId = "11111111-1111-4111-8111-111111111111";
export function groupedAlbumFixture(): LibraryDetail {
  const albums: ImportedRelease[] = (["melon", "genie"] as const).map((provider, index) => ({
    provider, externalId: String(100 + index), title: "함께 만든 앨범", date: "2026-10-01", type: "album", secondaryTypes: [], participation: false,
    artistName: "테스트 뮤지션", artistIds: ["12"], barcode: null, version: "", country: "KR", imageUrl: null,
    url: provider === "melon" ? "https://www.melon.com/album/detail.htm?albumId=100" : "https://www.genie.co.kr/detail/albumInfo?axnm=101", checkedAt: "2026-10-28T00:00:00Z",
    tracks: ["한 곡", "두 번째 곡"].map((title, position) => ({
      externalId: String(1000 + index * 10 + position), recordingId: String(1000 + index * 10 + position), title, version: "", artistName: "테스트 뮤지션", artistIds: ["12"],
      position: position + 1, discNumber: 1, durationMs: null, isrcs: [], managedByArtist: position === 0,
      url: provider === "melon" ? `https://www.melon.com/song/detail.htm?songId=${1000 + position}` : `https://www.genie.co.kr/detail/songInfo?xgnm=${1010 + position}`,
      works: [{ externalId: `work-${position}`, title, contributors: provider === "melon" ? [{ name: "함께한 저작자", role: "lyrics" }] : [{ name: "함께한 저작자", role: "lyrics" }, { name: "함께한 저작자", role: "composition" }, { name: "편곡 참여자", role: "arrangement" }] }],
    })),
  }));
  let data = mergeArchiveImports(createArchiveData("테스트 뮤지션"), albums);
  for (const [index, trackId] of ["melon-track:100:1000", "genie-track:101:1010"].entries()) {
    data = applyArchiveCommand(data, { type: "save_tasks", id: `history-${index}`, trackIds: [trackId], task: { kind: "review", agency: "KBS", status: index ? "not_started" : "completed", result: index ? "unknown" : "eligible", memo: index ? "기존 확인 내역" : "기존 완료 내역", attachmentIds: [] } });
  }
  return { library: { id: groupedLibraryId, version: 1, data }, jobs: [], reviews: [], onsideReviews: [], evidence: [], events: [] };
}
