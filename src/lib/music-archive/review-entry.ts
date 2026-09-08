import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseReleasedAlbumUrl } from "@/lib/released-album-url";
import { validateArchiveData, type ArchiveData } from "./model";
import type { ArchiveReviewContext, ArchiveReviewEntry } from "./review-entry-url";

export const archiveReviewContextSchema = z.object({ libraryId: z.string().uuid(), releaseId: z.string().min(1).max(200), trackId: z.string().min(1).max(200).optional() }).strict();
export const storedArchiveReviewContextSchema = archiveReviewContextSchema.extend({ trackIds: z.array(z.string().min(1).max(200)).min(1).max(100) });

/** Resolve exact owner-selected scope; titles alone never join or widen a request. */
export function resolveArchiveReviewEntry(data: ArchiveData, context: ArchiveReviewContext, trackIds?: string[]): ArchiveReviewEntry {
  const release = data.releases.find(row => row.id === context.releaseId && !row.excluded && !row.mergedInto);
  if (!release) throw new Error("신청할 앨범을 내 음악 관리에서 다시 선택해주세요.");
  const tracks = data.tracks.filter(row => row.releaseId === release.id && !row.excluded && !row.mergedInto && row.managed && (!context.trackId || row.id === context.trackId) && (!trackIds || trackIds.includes(row.id)))
    .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
  if (trackIds && (tracks.length !== new Set(trackIds).size || tracks.some(track => !trackIds.includes(track.id)))) throw new Error("신청 음원의 관리 상태가 변경되었습니다. 내 음악 관리에서 신청 범위를 확인해주세요.");
  if (tracks.length > 100) throw new Error("한 번에 100곡까지 신청할 수 있습니다. 음원을 나누어 신청해주세요.");
  if (!tracks.length) throw new Error("신청할 음원을 내 음악 관리에서 선택해주세요.");
  const priority = ["melon", "genie", "bugs", "apple"];
  const source = [...release.links].sort((a, b) => priority.indexOf(a.provider) - priority.indexOf(b.provider))
    .map(link => parseReleasedAlbumUrl(link.url)).find(Boolean);
  if (!source) throw new Error("앨범의 발매 링크를 내 음악 관리에 등록해주세요.");
  return { context, title: release.title, artistName: release.artistName || data.artist.name, releaseDate: release.releaseDate, albumUrl: source.canonicalUrl,
    tracks: tracks.map(track => ({ id: track.id, title: track.title, artistName: track.artistName || release.artistName || data.artist.name, discNumber: track.discNumber, trackNumber: track.trackNumber })) };
}

export async function getArchiveReviewEntry(owner: string, input: unknown, trackIds?: string[]): Promise<ArchiveReviewEntry> {
  const context = archiveReviewContextSchema.parse(input);
  const { data, error } = await createAdminClient().from("music_archive_libraries").select("data").eq("id", context.libraryId).eq("owner_id", owner).is("archived_at", null).maybeSingle();
  if (error || !data) throw new Error("신청할 앨범을 내 음악 관리에서 다시 선택해주세요.");
  return resolveArchiveReviewEntry(validateArchiveData(data.data), context, trackIds);
}
