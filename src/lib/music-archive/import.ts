import { createHash } from "node:crypto";
import { validateArchiveData, type ArchiveData, type ArchiveConflict, type ArchiveRelease, type ArchiveTrack } from "./model";
import type { ImportedRelease } from "./providers";

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
/** Exact provider IDs only. Metadata suggestions never overwrite private corrections/history. */
export function mergeArchiveImports(input: ArchiveData, releases: ImportedRelease[]) {
  const data = validateArchiveData(input);
  const conflict = (entityType: "release" | "track", existing: ArchiveRelease | ArchiveTrack, field: ArchiveConflict["field"], incoming: string | number | boolean | undefined, source: ArchiveConflict["source"]) => {
    const current = (existing as unknown as Record<string, unknown>)[field] ?? null;
    if (current === (incoming ?? null)) return;
    const id = `conflict:${hash([entityType, existing.id, field, JSON.stringify(incoming)].join(":"))}`;
    if (!data.conflicts.some(item => item.id === id)) data.conflicts.push({ id, entityType, entityId: existing.id, field, current: current as string | number | boolean | null, incoming: incoming ?? null, source, createdAt: source.checkedAt });
  };
  for (const release of releases) {
    const source = { provider: release.provider, externalId: release.externalId, checkedAt: release.checkedAt };
    let existing = data.releases.find(item => item.source?.provider === "musicbrainz" && item.source.externalId === release.externalId);
    const values = { barcode: release.barcode || undefined, title: release.title, type: release.type, releaseDate: release.date || undefined, artistName: release.artistName, version: release.version || undefined, participation: release.participation ? "participation" as const : "primary" as const };
    if (!existing) {
      existing = { id: `mb-release:${release.externalId}`, ...values, source, links: [{ provider: "musicbrainz", url: release.url, externalId: release.externalId }], excluded: false, userEdited: false };
      data.releases.push(existing);
    } else {
      for (const field of ["title", "type", "releaseDate", "artistName", "version", "participation", "barcode"] as const) conflict("release", existing, field, values[field], source);
      existing.source = source;
    }
    for (const track of release.tracks) {
      const trackSource = { provider: "musicbrainz" as const, externalId: track.externalId, checkedAt: release.checkedAt };
      let recordingId: string | undefined;
      let conflictingRecordingId: string | undefined;
      if (track.recordingId) {
        const matches = data.recordings.filter(item => item.source?.provider === "musicbrainz" && item.source.externalId === track.recordingId);
        const match = matches.find(item => item.title === track.title && (item.version ?? "") === track.version);
        if (!match && matches.length) conflictingRecordingId = matches[0].id;
        recordingId = match?.id ?? `mb-recording:${track.recordingId}:${hash(`${track.title}:${track.version}`)}`;
        if (!match && !data.recordings.some(item => item.id === recordingId)) data.recordings.push({ id: recordingId, title: track.title, version: track.version || undefined, isrc: track.isrcs.length === 1 ? track.isrcs[0] : undefined, workIds: [], source: { ...trackSource, externalId: track.recordingId } });
      }
      const previous = data.tracks.find(item => item.releaseId === existing!.id && item.source?.provider === "musicbrainz" && item.source.externalId === track.externalId);
      const trackValues = { title: track.title, artistName: track.artistName, version: track.version || undefined, discNumber: track.discNumber, trackNumber: track.position, managed: track.managedByArtist, recordingId };
      if (previous) {
        for (const field of ["title", "artistName", "version", "discNumber", "trackNumber", "managed", "recordingId"] as const) conflict("track", previous, field, trackValues[field], trackSource);
        previous.source = trackSource;
      } else data.tracks.push({ id: `mb-track:${release.externalId}:${track.externalId}`, releaseId: existing.id, ...trackValues, source: trackSource, links: [{ provider: "musicbrainz", url: track.url, externalId: track.recordingId ?? release.externalId }], excluded: false, userEdited: false });
      if (conflictingRecordingId) {
        const item = data.tracks.find(value => value.releaseId === existing!.id && value.source?.externalId === track.externalId)!;
        conflict("track", item, "recordingId", conflictingRecordingId, trackSource);
      }
    }
  }
  return validateArchiveData(data);
}
