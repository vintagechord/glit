import {
  reviewDocumentDataSchema,
  REVIEW_DOC_LIMITS,
  type ReviewAlbum, type ReviewDocumentData, type ReviewEvidence, type ReviewIssue, type ReviewTrack,
} from "./model";

const sourceFailure = (issue: ReviewIssue) => Boolean(issue.sourceId) && issue.severity === "error" &&
  (issue.id === `source:${issue.sourceId}` || issue.code === "URL_EXTRACTION_FAILED");
const overlaps = (left: string[], right: string[]) => left.some((id) => right.includes(id));
const key = (value: string) => value.trim().normalize("NFC");
const hasManualLyrics = (track: ReviewTrack) => track.lyrics.trim() !== "" || track.instrumentalConfirmed ||
  track.reviewedFields.some((field) => ["lyrics", "lyricStatus", "instrumentalConfirmed"].includes(field));

/** Only original job inputs with a collection failure are eligible; OCR/structure review is not a failed fetch. */
export function getReviewRetrySourceIds(
  data: ReviewDocumentData,
  inputSources: ReadonlyArray<{ id: string }>,
): string[] {
  const failed = new Set(data.sources.filter((source) => !source.text.trim()).map((source) => source.id));
  for (const issue of data.issues) if (sourceFailure(issue)) failed.add(issue.sourceId!);
  for (const album of data.albums) for (const track of album.tracks) {
    if (track.lyricStatus === "extraction_failed" && !hasManualLyrics(track)) {
      for (const id of track.sourceIds) failed.add(id);
    }
  }
  return [...new Set(inputSources.filter((source) => failed.has(source.id)).map((source) => source.id))];
}

/** Refresh evidence only where the retained field is unchanged, or where a failed lyric was recovered. */
function refreshEvidence<T extends ReviewAlbum | ReviewTrack>(current: T, incoming: T, recovered: string[] = []) {
  const previous = current as unknown as Record<string, unknown>;
  const next = incoming as unknown as Record<string, unknown>;
  const accepted = incoming.evidence.filter((entry) => !current.reviewedFields.includes(entry.field) &&
    (recovered.includes(entry.field) || (entry.field in previous && JSON.stringify(previous[entry.field]) === JSON.stringify(next[entry.field]))));
  const replacing = new Set(accepted.map((entry) => `${entry.sourceId}\0${entry.field}`));
  const evidence: ReviewEvidence[] = [...current.evidence.filter((entry) => !replacing.has(`${entry.sourceId}\0${entry.field}`)), ...accepted];
  current.evidence = [...new Map(evidence.map((entry) => [JSON.stringify(entry), entry])).values()];
  current.sourceIds = [...new Set([...current.sourceIds, ...incoming.sourceIds])];
}

/**
 * Merge a retry into a draft, never replacing an administrator's metadata or explicit blank.
 * URL extraction must first be remapped to the original job's source IDs by the worker.
 * Parser-generated IDs are matched only by a unique same-source album/track identity.
 */
export function mergeRetryExtraction(
  currentDraft: ReviewDocumentData,
  reextracted: ReviewDocumentData,
): ReviewDocumentData {
  const result = reviewDocumentDataSchema.parse(currentDraft);
  const incoming = reviewDocumentDataSchema.parse(reextracted);
  if (result.mode !== incoming.mode || result.applicationDate !== incoming.applicationDate) {
    throw new Error("재추출 모드 또는 신청일자가 원본 작업과 다릅니다.");
  }
  const eligible = new Set(getReviewRetrySourceIds(result, result.sources));
  const retried = new Set(incoming.sources.filter((source) => eligible.has(source.id)).map((source) => source.id));
  const success = new Set(incoming.sources.filter((source) => retried.has(source.id) && source.text.trim() &&
    !incoming.issues.some((issue) => issue.sourceId === source.id && sourceFailure(issue))).map((source) => source.id));
  result.sources = result.sources.map((source) => {
    const fresh = incoming.sources.find((entry) => entry.id === source.id && retried.has(entry.id));
    // A failed retry must not erase an earlier successful source snapshot.
    return fresh && (success.has(source.id) || !source.text.trim()) ? fresh : source;
  });
  result.issues = result.issues.filter((issue) => !(sourceFailure(issue) && success.has(issue.sourceId!)));
  const changedIssueIds = new Set<string>();
  const addIssue = (issue: ReviewIssue) => {
    result.issues = result.issues.filter((entry) => entry.id !== issue.id);
    result.issues.push(issue); changedIssueIds.add(issue.id);
  };
  const albumIds = new Map<string, string>();
  const trackIds = new Map<string, string>();
  const allIds = new Set(result.albums.flatMap((album) => [album.id, ...album.tracks.map((track) => track.id)]));
  const reserveId = (id: string) => {
    let candidate = id;
    for (let i = 1; allIds.has(candidate); i++) candidate = `${id.slice(0, 85)}-retry-${i}`;
    allIds.add(candidate); return candidate;
  };
  const cloneTrack = (track: ReviewTrack) => {
    const copy = structuredClone(track); copy.id = reserveId(track.id); trackIds.set(track.id, copy.id); return copy;
  };
  for (const fresh of incoming.albums) {
    if (!fresh.sourceIds.some((id) => success.has(id))) continue;
    const sameSource = result.albums.filter((album) => overlaps(album.sourceIds, fresh.sourceIds));
    const stable = sameSource.filter((album) => album.id === fresh.id);
    const exact = sameSource.filter((album) => Boolean(key(fresh.title) && key(fresh.artistName)) && key(album.title) === key(fresh.title) &&
      key(album.artistName) === key(fresh.artistName));
    const candidates = stable.length === 1 ? stable : exact;
    const album = candidates.length === 1 ? candidates[0] : undefined;
    if (!album) {
      const copy = structuredClone(fresh);
      copy.id = reserveId(fresh.id); albumIds.set(fresh.id, copy.id);
      copy.tracks = fresh.tracks.map(cloneTrack);
      copy.wbsTrackIds = fresh.wbsTrackIds.map((id) => trackIds.get(id) ?? id);
      const duplicate = sameSource.length > 0 || result.albums.some((entry) => key(entry.title) === key(fresh.title) && key(entry.artistName) === key(fresh.artistName));
      result.albums.push(copy);
      if (duplicate) addIssue({ id: `retry-album:${copy.id}`, code: "REEXTRACTION_ALBUM_MATCH_REQUIRED", severity: "error", albumId: copy.id,
        message: "재추출한 앨범과 기존 수정본의 연결을 확정할 수 없습니다. 원문을 비교해 합치거나 별도 앨범으로 확인해주세요." });
      continue;
    }
    albumIds.set(fresh.id, album.id);
    refreshEvidence(album, fresh);
    const used = new Set<string>();
    for (const next of fresh.tracks) {
      const sourceTracks = album.tracks.filter((track) => overlaps(track.sourceIds, next.sourceIds));
      const stableTracks = sourceTracks.filter((track) => track.id === next.id);
      const exactTracks = sourceTracks.filter((track) => track.number === next.number && key(track.title) === key(next.title));
      const matches = stableTracks.length === 1 ? stableTracks : exactTracks;
      const track = matches.length === 1 && !used.has(matches[0].id) ? matches[0] : undefined;
      if (!track) {
        const copy = cloneTrack(next); album.tracks.push(copy);
        addIssue({ id: `retry-track:${copy.id}`, code: "REEXTRACTION_TRACK_MATCH_REQUIRED", severity: "error", albumId: album.id, trackId: copy.id,
          message: "재추출한 곡을 추가했습니다. 기존 수정본과 중복 여부 및 트랙 순서를 확인해주세요." });
        continue;
      }
      used.add(track.id); trackIds.set(next.id, track.id);
      const recovered: string[] = [];
      if (track.lyricStatus === "extraction_failed" && !hasManualLyrics(track) && next.lyricStatus === "provided" && next.lyrics.trim()) {
        track.lyrics = next.lyrics; track.lyricStatus = "provided";
        recovered.push("lyrics", "lyricStatus");
        if (!track.existingTranslation && !track.reviewedFields.includes("existingTranslation")) {
          track.existingTranslation = next.existingTranslation; recovered.push("existingTranslation");
        }
        if (!track.translationSegments.length && !track.reviewedFields.includes("translationSegments")) {
          track.translationSegments = next.translationSegments; recovered.push("translationSegments");
        }
      }
      refreshEvidence(track, next, recovered);
    }
  }
  for (const issue of incoming.issues) {
    if (issue.sourceId && !retried.has(issue.sourceId)) continue;
    if (issue.albumId && !albumIds.has(issue.albumId)) continue;
    if (issue.trackId && !trackIds.has(issue.trackId)) continue;
    addIssue({ ...issue, albumId: issue.albumId ? albumIds.get(issue.albumId) : undefined, trackId: issue.trackId ? trackIds.get(issue.trackId) : undefined });
  }
  result.confirmedIssueIds = result.confirmedIssueIds.filter((id) => !changedIssueIds.has(id) &&
    (result.issues.some((issue) => issue.id === id) || !currentDraft.issues.some((issue) => issue.id === id)));
  if (result.sources.reduce((total, source) => total + source.text.length, 0) > REVIEW_DOC_LIMITS.sourceCharacters ||
    result.albums.reduce((total, album) => total + album.tracks.length, 0) > REVIEW_DOC_LIMITS.tracks) {
    throw new Error("재추출 병합 결과가 작업 전체 원문 또는 곡 수 제한을 초과했습니다. 기존 수정본은 보존했습니다.");
  }
  return reviewDocumentDataSchema.parse(result);
}
