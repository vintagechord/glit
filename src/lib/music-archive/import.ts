import { createHash } from "node:crypto";
import { validateArchiveData, type ArchiveData, type ArchiveConflict, type ArchiveRelease, type ArchiveTrack } from "./model";
import type { ImportedRelease } from "./providers";

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
/** Exact provider IDs only. Metadata suggestions never overwrite private corrections/history. */
export function mergeArchiveImports(input: ArchiveData, releases: ImportedRelease[], options: { combineManagedProfiles?: boolean; metadataOnly?: boolean } = {}) {
  const data = validateArchiveData(input);
  const conflict = (entityType: "release" | "track", existing: ArchiveRelease | ArchiveTrack, field: ArchiveConflict["field"], incoming: string | number | boolean | undefined, source: ArchiveConflict["source"]) => {
    const current = (existing as unknown as Record<string, unknown>)[field] ?? null;
    if (current === (incoming ?? null)) return;
    const id = `conflict:${hash([entityType, existing.id, field, JSON.stringify(incoming)].join(":"))}`;
    if (!data.conflicts.some(item => item.id === id)) data.conflicts.push({ id, entityType, entityId: existing.id, field, current: current as string | number | boolean | null, incoming: incoming ?? null, source, createdAt: source.checkedAt });
  };
  for (const release of releases) {
    const prefix = release.provider === "musicbrainz" ? "mb" : release.provider;
    const source = { provider: release.provider, externalId: release.externalId, checkedAt: release.checkedAt };
    let existing = data.releases.find(item => item.source?.provider === release.provider && item.source.externalId === release.externalId);
    const values = { imageUrl: release.imageUrl || undefined, barcode: release.barcode || undefined, title: release.title, type: release.type, releaseDate: release.date || undefined, artistName: release.artistName, version: release.version || undefined, participation: release.participation ? "participation" as const : "primary" as const };
    if (!existing && options.metadataOnly) continue;
    if (!existing) {
      existing = { id: `${prefix}-release:${release.externalId}`, ...values, source, links: [{ provider: release.provider, url: release.url, externalId: release.externalId }], excluded: false, userEdited: false };
      data.releases.push(existing);
    } else {
      // Confirmed profiles together represent one managed artist. Broaden only
      // derived ownership scope; explicit member corrections/exclusions stay intact.
      if (options.combineManagedProfiles && !existing.userEdited && !release.participation) existing.participation = "primary";
      for (const field of (options.metadataOnly ? [] : ["title", "type", "releaseDate", "artistName", "version", "participation", "barcode"] as const)) if (!(options.combineManagedProfiles && field === "participation" && existing.participation === "primary" && values.participation === "participation")) conflict("release", existing, field, values[field], source);
      if (release.imageUrl) {
        if (!existing.imageUrl || !existing.userEdited) existing.imageUrl = release.imageUrl;
        else conflict("release", existing, "imageUrl", release.imageUrl, source);
      }
      existing.source = source;
    }
    for (const track of release.tracks) {
      if (options.metadataOnly && !data.tracks.some(item => item.releaseId === existing!.id && item.source?.provider === release.provider && item.source.externalId === track.externalId)) continue;
      const trackSource = { provider: release.provider, externalId: track.externalId, checkedAt: release.checkedAt };
      let recordingId: string | undefined;
      let conflictingRecordingId: string | undefined;
      if (track.recordingId) {
        const matches = data.recordings.filter(item => item.source?.provider === release.provider && item.source.externalId === track.recordingId);
        const match = matches.find(item => item.title === track.title && (item.version ?? "") === track.version);
        if (!match && matches.length) conflictingRecordingId = matches[0].id;
        recordingId = match?.id ?? `${prefix}-recording:${track.recordingId}:${hash(`${track.title}:${track.version}`)}`;
        if (!match && !data.recordings.some(item => item.id === recordingId)) data.recordings.push({ id: recordingId, title: track.title, version: track.version || undefined, isrc: track.isrcs.length === 1 ? track.isrcs[0] : undefined, workIds: [], source: { ...trackSource, externalId: track.recordingId } });
      }
      if (recordingId && track.works?.length) {
        const recording = data.recordings.find(item => item.id === recordingId)!;
        for (const imported of track.works) {
          const workId = `${prefix}-work:${imported.externalId}`;
          let work = data.works.find(item => item.id === workId);
          const roleLabels = { lyrics: "작사", composition: "작곡", arrangement: "편곡" };
          const fields = { contributors: imported.contributors, writers: imported.contributors.map(item => `${roleLabels[item.role]}: ${item.name}`).join(" · ").slice(0, 500), iswc: imported.iswc, source: { ...trackSource, externalId: imported.externalId } };
          if (!work) { work = { id: workId, title: imported.title, institutionNumbers: [], ...fields }; data.works.push(work); }
          else if (!work.userEdited && imported.contributors.length) Object.assign(work, fields);
          if (!recording.workIds.includes(workId)) recording.workIds.push(workId);
        }
      }
      const previous = data.tracks.find(item => item.releaseId === existing!.id && item.source?.provider === release.provider && item.source.externalId === track.externalId);
      const trackValues = { title: track.title, artistName: track.artistName, version: track.version || undefined, discNumber: track.discNumber, trackNumber: track.position, managed: track.managedByArtist, recordingId: recordingId ?? previous?.recordingId };
      if (previous) {
        if (options.combineManagedProfiles && !previous.userEdited && track.managedByArtist) previous.managed = true;
        for (const field of (options.metadataOnly ? [] : ["title", "artistName", "version", "discNumber", "trackNumber", "managed", "recordingId"] as const)) if (!(options.combineManagedProfiles && field === "managed" && previous.managed && !trackValues.managed)) conflict("track", previous, field, trackValues[field], trackSource);
        previous.source = trackSource;
      } else data.tracks.push({ id: `${prefix}-track:${release.externalId}:${track.externalId}`, releaseId: existing.id, ...trackValues, source: trackSource, links: [{ provider: release.provider, url: track.url, externalId: release.provider === "musicbrainz" ? track.recordingId ?? release.externalId : track.externalId }], excluded: false, userEdited: false });
      if (conflictingRecordingId) {
        const item = data.tracks.find(value => value.releaseId === existing!.id && value.source?.provider === release.provider && value.source?.externalId === track.externalId)!;
        conflict("track", item, "recordingId", conflictingRecordingId, trackSource);
      }
    }
  }
  return validateArchiveData(data);
}
