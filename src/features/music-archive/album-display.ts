import { groupArchiveAlbums, type ArchiveAlbumGroup } from "@/lib/music-archive/album-groups";
import type { ArchiveCommand, ArchiveTask } from "@/lib/music-archive/model";
import type { Library, LibraryDetail } from "./types";

export type DisplayArchiveTask = ArchiveTask & { originalTrackId?: string };
export const originalTaskTrackId = (task: ArchiveTask) => (task as DisplayArchiveTask).originalTrackId ?? task.trackId;

/** Apply a member's shared edits to verified aliases, preserving each source's links and identity. */
export function albumDisplayCommands(commands: ArchiveCommand[], groups: ArchiveAlbumGroup[]): ArchiveCommand[] {
  return commands.flatMap<ArchiveCommand>(command => {
    if (command.type === "update_release") {
      const group = groups.find(group => group.releaseIds.includes(command.releaseId));
      const patch = Object.fromEntries(Object.entries(command.patch).filter(([key]) => ["title", "type", "releaseDate", "version", "artistName"].includes(key)));
      return [command, ...(Object.keys(patch).length ? (group?.releaseIds ?? []).filter(id => id !== command.releaseId).map(releaseId => ({ type: "update_release" as const, releaseId, patch })) : [])];
    }
    if (command.type === "update_track") {
      const group = groups.flatMap(group => group.tracks).find(group => group.trackIds.includes(command.trackId));
      const patch = Object.fromEntries(Object.entries(command.patch).filter(([key]) => ["title", "version", "artistName", "trackNumber"].includes(key)));
      return [command, ...(Object.keys(patch).length ? (group?.trackIds ?? []).filter(id => id !== command.trackId).map(trackId => ({ type: "update_track" as const, trackId, patch })) : [])];
    }
    if (command.type === "add_track") {
      const group = groups.find(group => group.releaseIds.includes(command.track.releaseId));
      return [command, ...(group?.releaseIds ?? []).filter(id => id !== command.track.releaseId).map(releaseId => ({ type: "add_track" as const, track: { ...command.track, id: crypto.randomUUID(), releaseId, links: [] } }))];
    }
    return [command];
  });
}

export function libraryDisplayCounts(library: Library) {
  if (library.summary) return library.summary;
  const groups = groupArchiveAlbums(library.data);
  return { releaseCount: groups.length, trackCount: groups.reduce((count, group) => count + group.tracks.filter(item => item.track.managed).length, 0) };
}

/** Rendering only. Never save this document or use its entities in source editors. */
export function albumDisplayDetail(detail: LibraryDetail, groups: ArchiveAlbumGroup[] = groupArchiveAlbums(detail.library.data)): LibraryDetail {
  const raw = detail.library.data;
  const releaseIds = new Map(groups.flatMap(group => group.releaseIds.map(id => [id, group.release.id] as const)));
  const trackIds = new Map(groups.flatMap(group => group.tracks.flatMap(item => item.trackIds.map(id => [id, item.track.id] as const))));
  const rawTracks = new Map(raw.tracks.map(track => [track.id, track]));
  const rawRecordings = new Map(raw.recordings.map(recording => [recording.id, recording]));
  const recordings = new Map(raw.recordings.map(recording => [recording.id, { ...recording, workIds: [...recording.workIds] }]));
  const tracks = groups.flatMap(group => group.tracks.map(item => {
    const aliases = item.trackIds.flatMap(id => { const track = rawTracks.get(id); return track ? [track] : []; });
    const sourceRecordingId = item.track.recordingId ?? aliases.find(track => track.recordingId)?.recordingId;
    const recording = rawRecordings.get(sourceRecordingId ?? "");
    let recordingId = sourceRecordingId;
    if (recording) {
      // A source recording can be shared by different songs. Keep each verified
      // alias group's additional credits in its own rendering-only recording.
      const displayId = `display-recording:${item.track.id}`;
      recordingId = displayId;
      for (let suffix = 1; recordings.has(recordingId); suffix++) recordingId = `${displayId}:${suffix}`;
      recordings.set(recordingId, { ...recording, id: recordingId, workIds: [...new Set(aliases.flatMap(track => rawRecordings.get(track.recordingId ?? "")?.workIds ?? []))] });
    }
    return { ...item.track, releaseId: group.release.id, recordingId };
  }));
  const tasks: DisplayArchiveTask[] = raw.tasks.map(task => ({ ...task, originalTrackId: task.trackId, trackId: trackIds.get(task.trackId) ?? task.trackId }));
  const reviewsBySubmission = new Map<string, NonNullable<LibraryDetail["onsideReviews"]>[number]>();
  for (const review of detail.onsideReviews ?? []) {
    // A legacy whole-album result covers its original songs, not newly grouped extras.
    const originalIds = review.trackIds.length ? review.trackIds : raw.tracks.filter(track => track.releaseId === review.releaseId && !track.excluded && !track.mergedInto).map(track => track.id);
    const mapped = { ...review, releaseId: releaseIds.get(review.releaseId) ?? review.releaseId, trackIds: [...new Set(originalIds.map(id => trackIds.get(id) ?? id))] };
    const key = JSON.stringify([mapped.submissionId, mapped.releaseId, mapped.status]);
    const previous = reviewsBySubmission.get(key);
    reviewsBySubmission.set(key, previous ? { ...mapped, trackIds: [...new Set([...previous.trackIds, ...mapped.trackIds])] } : mapped);
  }
  const onsideReviews = [...reviewsBySubmission.values()];
  return { ...detail, onsideReviews, library: { ...detail.library, data: { ...raw, releases: groups.map(group => ({ ...group.release })), tracks, recordings: [...recordings.values()], tasks } } };
}
