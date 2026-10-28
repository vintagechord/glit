import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseReleasedAlbumUrl } from "@/lib/released-album-url";
import { validateArchiveData, type ArchiveData } from "./model";
import { findArchiveAlbumGroup } from "./album-groups";
import type { ArchiveReviewContext, ArchiveReviewEntry } from "./review-entry-url";

export const archiveReviewContextSchema = z.object({ libraryId: z.string().uuid(), releaseId: z.string().min(1).max(200), trackId: z.string().min(1).max(200).optional() }).strict();
export const storedArchiveReviewContextSchema = archiveReviewContextSchema.extend({ trackIds: z.array(z.string().min(1).max(200)).min(1).max(100) });

/** Preserve saved real IDs; only new selections choose a verified group's representative. */
export function resolveArchiveReviewScope(data: ArchiveData, context: ArchiveReviewContext, trackIds?: string[]) {
  const group = findArchiveAlbumGroup(data, context.releaseId);
  if (!group) throw new Error("신청할 앨범을 내 음악 관리에서 다시 선택해주세요.");
  const selected = context.trackId ? group.tracks.find(item => item.trackIds.includes(context.trackId!)) : undefined;
  if (context.trackId && !selected) throw new Error("신청할 음원을 내 음악 관리에서 선택해주세요.");
  const available = new Map(data.tracks.filter(track => group.releaseIds.includes(track.releaseId) && track.managed && !track.excluded && !track.mergedInto).map(track => [track.id, track]));
  const logicalIds = new Set<string>();
  const tracks = trackIds ? trackIds.map(id => {
    const track = available.get(id);
    const logical = group.tracks.find(item => item.trackIds.includes(id));
    if (!track || !logical || (selected && logical !== selected) || logicalIds.has(logical.track.id)) throw new Error("신청 음원의 관리 상태가 변경되었습니다. 내 음악 관리에서 신청 범위를 확인해주세요.");
    logicalIds.add(logical.track.id);
    return track;
  }) : (selected ? [selected] : group.tracks).map(item => item.track).filter(track => available.has(track.id))
    .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber || a.id.localeCompare(b.id));
  if (tracks.length > 100) throw new Error("한 번에 100곡까지 신청할 수 있습니다. 음원을 나누어 신청해주세요.");
  if (!tracks.length) throw new Error("신청할 음원을 내 음악 관리에서 선택해주세요.");
  return { release: group.release, tracks };
}

/** Resolve exact owner-selected scope; titles alone never join or widen a request. */
export function resolveArchiveReviewEntry(data: ArchiveData, context: ArchiveReviewContext, trackIds?: string[]): ArchiveReviewEntry {
  const { release, tracks } = resolveArchiveReviewScope(data, context, trackIds);
  const priority = ["melon", "genie", "bugs", "apple", "spotify"];
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
