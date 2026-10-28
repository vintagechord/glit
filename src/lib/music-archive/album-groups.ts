import type { ArchiveData, ArchiveProvider, ArchiveRelease, ArchiveTrack, ServiceLink } from "./model";
import { parseMusicProviderUrl } from "./providers";

export type ArchiveAlbumTrackGroup = { track: ArchiveTrack; trackIds: string[] };
export type ArchiveAlbumGroup = { release: ArchiveRelease; releaseIds: string[]; tracks: ArchiveAlbumTrackGroup[] };
type AlbumGroupData = Pick<ArchiveData, "releases" | "tracks" | "recordings">;

const normalize = (value?: string) => (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
const providerOrder: ArchiveProvider[] = ["melon", "genie", "bugs", "apple", "spotify", "musicbrainz", "youtube"];
const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const position = (track: ArchiveTrack) => `${track.discNumber}:${track.trackNumber}`;
const comparePosition = (a: ArchiveTrack, b: ArchiveTrack) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber || compareId(a, b);
const unavailable = (title: string) => /^(?:재생\s*불가|서비스\s*(?:불가|중지)|unavailable)$/i.test(title.trim());

// Public links also survive member projection, unlike internal source metadata.
function providers(links: ServiceLink[], kind: "release" | "track") {
  return new Set(links.flatMap(link => {
    const parsed = parseMusicProviderUrl(link.url, kind);
    return parsed?.provider === link.provider ? [parsed.provider] : [];
  }));
}
function priority(links: ServiceLink[], kind: "release" | "track") {
  return Math.min(providerOrder.length, ...[...providers(links, kind)].map(provider => providerOrder.indexOf(provider)));
}
const compareRelease = (a: ArchiveRelease, b: ArchiveRelease) => Number(b.userEdited) - Number(a.userEdited) || priority(a.links, "release") - priority(b.links, "release") || compareId(a, b);
const compareTrack = (a: ArchiveTrack, b: ArchiveTrack) => Number(b.managed) - Number(a.managed) || Number(b.userEdited) - Number(a.userEdited) || priority(a.links, "track") - priority(b.links, "track") || compareId(a, b);
function unionLinks(rows: { links: ServiceLink[] }[]) {
  const links = new Map<string, ServiceLink>();
  for (const row of rows) for (const link of row.links) {
    const key = `${link.provider}:${link.url}`;
    if (!links.has(key)) links.set(key, { ...link });
  }
  return [...links.values()].sort((a, b) => providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

function artistCompatible(a?: string, b?: string) {
  const tokens = (value?: string) => new Set(normalize(value).split(/\s+&\s+/).filter(Boolean));
  const left = tokens(a); const right = tokens(b);
  return left.size > 0 && right.size > 0 && ([...left].every(name => right.has(name)) || [...right].every(name => left.has(name)));
}

// Normalize observed credit typography, not editions or arbitrary punctuation.
function trackTitle(value: string) {
  return normalize(value).replace(/\(intro\)$/i, "intro").replace(/\(([^()]*)\)/g, (original, content: string) => {
    const credit = content.match(/^(feat(?:uring)?|with|vocal(?:\s+by)?)(?:\.\s*|\s+)(.+)$/i);
    if (!credit) return original;
    const role = credit[1].startsWith("feat") ? "feat" : credit[1].startsWith("vocal") ? "vocal" : "with";
    const names = credit[2].split(/\s*(?:,|&)\s*/).map(normalize).filter(Boolean).sort();
    return names.length ? `(${role}:${names.join(",")})` : original;
  }).replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").replace(/\s+/g, " ").trim();
}

function editions(title: string) {
  const value = normalize(title);
  const parts = [...(value.match(/[([][^)\]]*[)\]]/g) ?? []), ...(value.match(/\s-\s[^()[\]]+$/g) ?? [])];
  return parts.filter(part => /\b(?:inst|instrumental|live|remix|remaster(?:ed)?|version|ver|edit|acoustic|demo|guide|cd only|hidden track|mono|stereo|karaoke)\b/.test(part)).join("|");
}

function fullDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** A read-only view: originals, task links, rights and management flags stay intact. */
export function groupArchiveAlbums(data: AlbumGroupData): ArchiveAlbumGroup[] {
  const releases = data.releases.filter(release => !release.excluded && !release.mergedInto);
  const tracksByRelease = new Map<string, ArchiveTrack[]>();
  for (const track of data.tracks) {
    if (track.excluded || track.mergedInto) continue;
    const tracks = tracksByRelease.get(track.releaseId) ?? [];
    tracks.push(track); tracksByRelease.set(track.releaseId, tracks);
  }
  for (const tracks of tracksByRelease.values()) tracks.sort(comparePosition);
  const recordingById = new Map(data.recordings.map(recording => [recording.id, recording]));
  const providerById = new Map(releases.map(release => [release.id, providers(release.links, "release")]));
  function trackMetadata(a: ArchiveTrack, b: ArchiveTrack) {
    if (position(a) !== position(b) || normalize(a.version) !== normalize(b.version) || !artistCompatible(a.artistName, b.artistName)) return { compatible: false, sameIsrc: false };
    const ar = a.recordingId ? recordingById.get(a.recordingId) : undefined;
    const br = b.recordingId ? recordingById.get(b.recordingId) : undefined;
    if (normalize(ar?.version) !== normalize(br?.version)) return { compatible: false, sameIsrc: false };
    const isrc = (value?: string) => normalize(value).replace(/[\s-]/g, "");
    const ai = isrc(ar?.isrc); const bi = isrc(br?.isrc);
    return { compatible: !(ai && bi && ai !== bi), sameIsrc: /^[a-z]{2}[a-z0-9]{3}\d{7}$/.test(ai) && ai === bi };
  }
  function compatibleTracks(a: ArchiveTrack, b: ArchiveTrack) {
    if (unavailable(a.title) || unavailable(b.title) || editions(a.title) !== editions(b.title)) return false;
    const metadata = trackMetadata(a, b);
    return metadata.compatible && (trackTitle(a.title) === trackTitle(b.title) || metadata.sameIsrc);
  }
  function compatibleReleases(a: ArchiveRelease, b: ArchiveRelease) {
    const ap = providerById.get(a.id)!; const bp = providerById.get(b.id)!;
    if (!ap.size || !bp.size || [...ap].some(provider => bp.has(provider))) return false;
    if (normalize(a.title) !== normalize(b.title) || !fullDate(a.releaseDate) || a.releaseDate !== b.releaseDate || normalize(a.version) !== normalize(b.version) || !artistCompatible(a.artistName, b.artistName)) return false;
    if (a.type !== "other" && b.type !== "other" && a.type !== b.type) return false;
    if (a.barcode && b.barcode && normalize(a.barcode) !== normalize(b.barcode)) return false;
    const at = tracksByRelease.get(a.id) ?? []; const bt = tracksByRelease.get(b.id) ?? [];
    if (!at.length || at.length !== bt.length || new Set(at.map(position)).size !== at.length || new Set(bt.map(position)).size !== bt.length) return false;
    let placeholders = 0; let known = 0;
    for (let i = 0; i < at.length; i++) {
      if (position(at[i]) !== position(bt[i])) return false;
      if (compatibleTracks(at[i], bt[i])) { known++; continue; }
      // Album grouping tolerates one missing title, but this is NOT a song alias.
      if (unavailable(at[i].title) !== unavailable(bt[i].title) && trackMetadata(at[i], bt[i]).compatible) { placeholders++; continue; }
      return false;
    }
    return placeholders === 0 || (placeholders === 1 && known >= 2);
  }

  // Compare only same-title/date candidates; never use transitive fuzzy matches.
  const buckets = new Map<string, ArchiveRelease[]>();
  for (const release of releases) {
    const key = JSON.stringify([normalize(release.title), release.releaseDate]);
    const bucket = buckets.get(key) ?? []; bucket.push(release); buckets.set(key, bucket);
  }
  const adjacency = new Map(releases.map(release => [release.id, new Set<string>()]));
  for (const bucket of buckets.values()) for (let i = 0; i < bucket.length; i++) for (let j = i + 1; j < bucket.length; j++) {
    if (compatibleReleases(bucket[i], bucket[j])) { adjacency.get(bucket[i].id)!.add(bucket[j].id); adjacency.get(bucket[j].id)!.add(bucket[i].id); }
  }
  const byId = new Map(releases.map(release => [release.id, release]));
  const visited = new Set<string>();
  const groups: ArchiveAlbumGroup[] = [];
  function makeGroup(members: ArchiveRelease[]) {
    members.sort(compareRelease);
    const trackGroups = new Map<string, ArchiveTrack[][]>();
    for (const release of members) for (const track of tracksByRelease.get(release.id) ?? []) {
      const slot = trackGroups.get(position(track)) ?? [];
      const candidates = slot.filter(group => group.every(other => other.releaseId !== track.releaseId && compatibleTracks(track, other)));
      if (candidates.length === 1) candidates[0].push(track); else slot.push([track]);
      trackGroups.set(position(track), slot);
    }
    const tracks = [...trackGroups.values()].flat().map(members => {
      members.sort(compareTrack);
      return { track: { ...members[0], links: unionLinks(members) }, trackIds: members.map(track => track.id) };
    }).sort((a, b) => comparePosition(a.track, b.track));
    groups.push({ release: { ...members[0], links: unionLinks(members) }, releaseIds: members.map(release => release.id), tracks });
  }
  for (const release of releases) {
    if (visited.has(release.id)) continue;
    const component: string[] = []; const pending = [release.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id); component.push(id);
      pending.push(...adjacency.get(id)!);
    }
    // Same-provider duplicates or a partial match chain make the whole set ambiguous.
    if (component.every(id => adjacency.get(id)!.size === component.length - 1)) makeGroup(component.map(id => byId.get(id)!));
    else for (const id of component.sort()) makeGroup([byId.get(id)!]);
  }
  return groups.sort((a, b) => compareId(a.release, b.release));
}

export function findArchiveAlbumGroup(data: AlbumGroupData, releaseId: string): ArchiveAlbumGroup | undefined {
  return groupArchiveAlbums(data).find(group => group.releaseIds.includes(releaseId));
}
