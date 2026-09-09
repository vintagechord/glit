/** Explicit member response projection. Full provenance and audit data stay in admin responses. */
const keep = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]));
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value : [];
const currentJobs = (value: unknown) => {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows(value).sort((a, b) => String(b.created_at ?? b.updated_at ?? "").localeCompare(String(a.created_at ?? a.updated_at ?? "")))) {
    const key = `${row.library_id}:${row.provider}:${row.external_artist_id}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()].map(row => keep(row, ["id", "library_id", "status"]));
};

export function memberLibrary(value: unknown) {
  const library = value as Record<string, unknown>;
  const data = (library.data ?? {}) as Record<string, unknown>;
  const artist = (data.artist ?? {}) as Record<string, unknown>;
  return {
    ...keep(library, ["id", "version", "archived_at", "updated_at", "summary"]),
    data: {
      schemaVersion: data.schemaVersion,
      artist: keep(artist, ["id", "name", "disambiguation", "note", "links"]),
      releases: rows(data.releases).map(row => keep(row, ["id", "title", "type", "releaseDate", "participation", "version", "artistName", "barcode", "imageUrl", "links", "excluded", "mergedInto", "userEdited"])),
      tracks: rows(data.tracks).map(row => keep(row, ["id", "releaseId", "title", "discNumber", "trackNumber", "recordingId", "version", "artistName", "managed", "links", "excluded", "mergedInto", "userEdited"])),
      recordings: rows(data.recordings).map(row => keep(row, ["id", "title", "version", "isrc", "workIds", "userEdited"])),
      works: rows(data.works).map(row => keep(row, ["id", "title", "writers", "contributors", "iswc", "institutionNumbers", "userEdited"])),
      tasks: rows(data.tasks).map(row => keep(row, ["id", "trackId", "kind", "agency", "status", "result", "participant", "role", "recordingId", "workId", "applicationDate", "completedDate", "checkedDate", "referenceNumber", "songNumber", "memo"])),
      reviewLinks: rows(data.reviewLinks).map(row => keep(row, ["id", "submissionId", "releaseId", "trackId", "submissionTrackId"])),
      connections: rows(data.connections).map(row => keep(row, ["provider", "externalArtistId", "url", "confirmed"])),
      affiliations: [], conflicts: [],
    },
  };
}

export function memberArchiveResponse(value: unknown): Record<string, unknown> {
  const response = value as Record<string, unknown>;
  const result = { ...response };
  if (response.library) result.library = memberLibrary(response.library);
  if (response.libraries) result.libraries = rows(response.libraries).map(memberLibrary);
  if (response.jobs) result.jobs = currentJobs(response.jobs);
  if (response.job) result.job = keep(response.job as Record<string, unknown>, ["id", "library_id", "status"]);
  if (response.guides) result.guides = rows(response.guides).filter(guide => ["komca", "koscap", "fkmp", "tj", "ky"].includes(String(guide.id))).map(row => keep(row, ["id", "name", "kind", "introduction", "preparation", "steps", "url", "searchUrl", "applyUrl", "visible"]));
  if (response.providers) result.providers = rows(response.providers).map(row => keep(row, ["id", "status", "automaticImplemented"]));
  if (response.reviews) result.reviews = rows(response.reviews).map(row => keep(row, ["id", "title", "artist_name", "release_date", "status", "album_tracks", "station_reviews"]));
  // Detail endpoints and mutation responses use the same boundary.
  delete result.events; delete result.evidence; delete result.runLibraryId;
  return result;
}
