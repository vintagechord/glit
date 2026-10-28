import { createHash } from "node:crypto";
import { fetchMelonAlbumReviewData, parseMelonSongPage, type MelonAlbumReviewData } from "@/lib/melon";
import { fetchGenieAlbumReviewData, parseGenieAlbumPage, parseGenieSongPage } from "@/lib/genie";
import { canonicalReviewUrl, createReviewUrlFetcher } from "@/lib/review-docs/urls";
import { safeWebUrlSchema, validateArchiveData, type ArchiveContributor, type ArchiveData, type ArchiveTrack } from "./model";
import { parseMusicProviderUrl } from "./providers";
import { matchArchiveReviews } from "./reviews";
import { MusicProviderError } from "./musicbrainz";
import type { CreditSubmission } from "./credits";

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const roleLabels = { lyrics: "작사", composition: "작곡", arrangement: "편곡" };

export type DomesticTrackCredits = {
  provider: "melon" | "genie"; albumId: string; songId: string;
  contributors: ArchiveContributor[]; checkedAt: string; fallback?: true;
};
type DomesticCreditAlbum = Omit<MelonAlbumReviewData, "tracks"> & {
  tracks: (MelonAlbumReviewData["tracks"][number] & { creditFallbackRoles?: ArchiveContributor["role"][] })[];
};
function contributorsFromFields(fields: { lyricist: string; composer: string; arranger: string }): ArchiveContributor[] {
  const unique = new Map<string, ArchiveContributor>();
  for (const [role, value] of [["lyrics", fields.lyricist], ["composition", fields.composer], ["arrangement", fields.arranger]] as const) {
    for (const name of value.split(/[,;\n]/).map(value => value.trim()).filter(Boolean)) {
      const person = { name: name.slice(0, 500), role };
      unique.set(JSON.stringify([role, normalize(person.name)]), person);
    }
  }
  return [...unique.values()].slice(0, 100);
}

function albumCreditText(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(?:div|p|li|h[1-6])>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, name: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[name.toLowerCase()] ?? "");
}
const creditTitle = (value: string) => normalize(value).replace(/[^\p{L}\p{N}]/gu, "");

/** Only numbered song credits in this exact official album, never album-wide names. */
export function parseGenieAlbumCreditFallbacks(html: string, album: { albumId: string; tracks: { songId: string; trackNo: number; trackTitle: string }[] }, checkedAt: string): DomesticTrackCredits[] {
  const declaredId = html.match(/\bvar\s+_rfr\s*=\s*["']\/detail\/albumInfo\?axnm=(\d+)/)?.[1];
  if (declaredId !== album.albumId) return [];
  const section = html.match(/<!--\s*S\.\s*앨범 DESC albumDesc\s*-->([\s\S]*?)<!--\s*E\.\s*앨범 DESC\s*-->/)?.[1];
  if (!section) return [];
  const lines = albumCreditText(section).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const markers = lines.flatMap((line, index) => /^\[credits?\]$/i.test(line) ? [index] : []);
  if (markers.length !== 1) return [];
  const blocks: { number: number; title: string; lyricist: string; composer: string; arranger: string }[] = [];
  let current: typeof blocks[number] | undefined;
  for (const line of lines.slice(markers[0] + 1)) {
    const heading = line.match(/^(\d{1,3})[.)]\s+(.+)$/);
    if (heading) {
      current = { number: Number(heading[1]), title: heading[2], lyricist: "", composer: "", arranger: "" };
      blocks.push(current); continue;
    }
    if (!current) continue;
    const role = line.match(/^(Composed\s*(?:&|and)\s*Arranged|Composed|Arranged|Lyrics)\s+by\s+(.+)$/i);
    // Only consecutive role lines belong to a numbered song. A footer, other
    // production credit or missing line boundary ends this conservative scope.
    if (!role || /(?:Composed|Arranged|Lyrics)\s+by/i.test(role[2])) { current = undefined; continue; }
    const name = role[2].trim();
    const fields = /composed/i.test(role[1]) ? /arranged/i.test(role[1]) ? ["composer", "arranger"] as const : ["composer"] as const : /arranged/i.test(role[1]) ? ["arranger"] as const : ["lyricist"] as const;
    for (const field of fields) current[field] = [current[field], name].filter(Boolean).join(", ");
  }
  return blocks.flatMap(block => {
    const title = creditTitle(block.title);
    if (!title || blocks.filter(other => other.number === block.number || creditTitle(other.title) === title).length !== 1) return [];
    const sameTitle = album.tracks.filter(track => creditTitle(track.trackTitle) === title);
    if (sameTitle.length !== 1) return [];
    const track = sameTitle[0];
    if (track.trackNo !== block.number || album.tracks.filter(other => other.trackNo === block.number || other.songId === track.songId).length !== 1
      || !/^[1-9]\d{0,19}$/.test(track.songId) || /재생\s*불가|서비스\s*(?:불가|중지)|unavailable/i.test(track.trackTitle)) return [];
    const contributors = contributorsFromFields(block);
    return contributors.length ? [{ provider: "genie" as const, albumId: album.albumId, songId: track.songId, contributors, checkedAt, fallback: true as const }] : [];
  });
}

/** The fixed song URL is fetched by the catalog collector; retain credits only. */
export function parseDomesticTrackCredits(provider: "melon" | "genie", html: string, albumId: string, songId: string, checkedAt: string): DomesticTrackCredits {
  const detail = (provider === "melon" ? parseMelonSongPage : parseGenieSongPage)(html, songId);
  const declaredId = provider === "melon"
    ? html.match(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["'][^"']*\/song\/detail\.htm\?songId=(\d+)/i)?.[1]
    : html.match(/\bvar\s+_rfr\s*=\s*["']\/detail\/songInfo\?xgnm=(\d+)/)?.[1];
  if (!detail.trackTitle || (declaredId !== undefined && declaredId !== songId)) throw new MusicProviderError("invalid_response", "선택한 곡의 저작자 정보와 식별자를 확인하지 못했습니다. 저장한 앨범과 곡은 유지됩니다.");
  return { provider, albumId, songId, contributors: contributorsFromFields(detail), checkedAt };
}

function trackProviderIds(track: ArchiveTrack, provider: "melon" | "genie") {
  return [...new Set([
    ...(track.source?.provider === provider ? [track.source.externalId] : []),
    ...track.links.flatMap(link => { const parsed = parseMusicProviderUrl(link.url, "track"); return parsed?.provider === provider ? [parsed.externalId] : []; }),
  ])];
}

function applyTrackCredits(data: ArchiveData, track: ArchiveTrack, update: Omit<DomesticTrackCredits, "albumId">) {
  const { provider, songId, checkedAt } = update;
  let contributors = update.contributors;
  if (!contributors.length) return;
  const recordingId = track.recordingId ?? `archive-recording:${hash(track.id)}`;
  let recording = data.recordings.find(item => item.id === recordingId);
  if (update.fallback && recording) {
    const knownRoles = new Set(recording.workIds.flatMap(id => data.works.find(work => work.id === id)?.contributors?.map(person => person.role) ?? []));
    contributors = contributors.filter(person => !knownRoles.has(person.role));
    if (!contributors.length) return;
  }
  if (!recording) { recording = { id: recordingId, title: track.title, workIds: [] }; data.recordings.push(recording); track.recordingId = recordingId; }
  if (recording.workIds.some(id => data.works.find(work => work.id === id)?.userEdited)) return;
  const workId = `${provider}-work:${songId}`;
  let work = data.works.find(item => item.id === workId);
  if (work?.userEdited) return;
  const importedRoles = new Set(contributors.map(item => item.role));
  const refreshedContributors = [...contributors, ...(work?.contributors ?? []).filter(item => !importedRoles.has(item.role))].slice(0, 100);
  const fields = { contributors: refreshedContributors, writers: refreshedContributors.map(item => `${roleLabels[item.role]}: ${item.name}`).join(" · ").slice(0, 500), source: { provider, externalId: songId, checkedAt } };
  if (!work) { work = { id: workId, title: track.title, institutionNumbers: [], ...fields }; data.works.push(work); }
  else Object.assign(work, fields);
  // Partial public credits cannot erase known roles or detach registrations.
  const availableRoles = new Set(refreshedContributors.map(item => item.role));
  recording.workIds = recording.workIds.filter(id => !id.startsWith("onside-work:")
    || data.tasks.some(task => task.workId === id)
    || data.works.find(item => item.id === id)?.contributors?.some(item => !availableRoles.has(item.role)));
  if (!recording.workIds.includes(workId)) recording.workIds.push(workId);
}

/** Exact album AND song IDs only; public writer names never broaden ownership. */
export function mergeDomesticTrackCredits(input: ArchiveData, updates: DomesticTrackCredits[]): ArchiveData {
  const data = validateArchiveData(input);
  for (const update of updates) {
    const releases = data.releases.filter(release => !release.excluded && !release.mergedInto && (
      (release.source?.provider === update.provider && release.source.externalId === update.albumId)
      || release.links.some(link => { const parsed = parseMusicProviderUrl(link.url, "release"); return parsed?.provider === update.provider && parsed.externalId === update.albumId; })
    ));
    // Explicitly merged/multiple exact-ID albums require manual disambiguation.
    if (releases.length !== 1) continue;
    const candidates = data.tracks.filter(track => track.releaseId === releases[0].id && !track.excluded && !track.mergedInto && trackProviderIds(track, update.provider).includes(update.songId));
    if (candidates.length === 1) applyTrackCredits(data, candidates[0], update);
  }
  return validateArchiveData(data);
}

/** Only the album page's declared artwork; no image download or guessed CDN path. */
export function domesticAlbumArtwork(html: string, albumUrl: string): string | null {
  const identity = canonicalReviewUrl(albumUrl);
  const hosts = identity.provider === "melon" ? ["melon.com", "melon.co.kr"] : ["genie.co.kr"];
  const candidates: { priority: number; value: string }[] = [];
  for (const tag of html.match(/<(?:meta|link)\b[^>]*>/gi) ?? []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
    const property = (attributes.property ?? attributes.name ?? "").toLowerCase();
    const value = ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(property) ? attributes.content : attributes.rel?.toLowerCase() === "image_src" ? attributes.href : undefined;
    if (value) candidates.push({ priority: property === "og:image:secure_url" ? 0 : property === "og:image" ? 1 : 2, value });
  }
  for (const { value } of candidates.sort((a, b) => a.priority - b.priority)) {
    try {
      const decoded = value.replace(/&amp;/gi, "&").replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
        const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
        return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
      });
      const image = new URL(decoded, identity.url);
      if (!["https:", "http:"].includes(image.protocol)) continue;
      image.protocol = "https:";
      if (safeWebUrlSchema.safeParse(image.toString()).success && hosts.some(host => image.hostname === host || image.hostname.endsWith(`.${host}`))) return image.toString();
    } catch { /* Ignore an invalid candidate and try the next declared thumbnail. */ }
  }
  return null;
}

/** Only explicitly linked URLs or exact archive/submission scopes; never catalog name searches. */
export function linkedDomesticAlbumUrl(data: ArchiveData, releaseId: string, submissions: CreditSubmission[], libraryId: string): string | null {
  const release = data.releases.find(item => item.id === releaseId);
  const direct = release?.links.find(link => ["melon", "genie"].includes(link.provider) && parseMusicProviderUrl(link.url, "release"));
  if (direct) return direct.url;
  const scopes = matchArchiveReviews(data, submissions, libraryId).filter(scope => scope.releaseId === releaseId);
  const urls = [...new Set(scopes.flatMap(scope => {
    const row = submissions.find(submission => submission.id === scope.submissionId);
    const link = row?.melon_url ? parseMusicProviderUrl(row.melon_url, "release") : null;
    return link && ["melon", "genie"].includes(link.provider) ? [link.url] : [];
  }))];
  return urls.length === 1 ? urls[0] : null;
}

export function mergeDomesticAlbumCredits(input: ArchiveData, releaseId: string, album: DomesticCreditAlbum, provider: "melon" | "genie", checkedAt: string, imageUrl?: string | null): ArchiveData {
  const data = validateArchiveData(input);
  const release = data.releases.find(item => item.id === releaseId);
  if (!release) return data;
  if (imageUrl && safeWebUrlSchema.safeParse(imageUrl).success && (!release.imageUrl || !release.userEdited)) release.imageUrl = imageUrl;
  for (const imported of album.tracks) {
    const candidates = data.tracks.filter(track => {
      if (track.releaseId !== releaseId || track.excluded || track.mergedInto) return false;
      const ids = trackProviderIds(track, provider);
      return ids.length ? ids.includes(imported.songId) : track.trackNumber === imported.trackNo && normalize(track.title) === normalize(imported.trackTitle);
    });
    if (candidates.length !== 1) continue;
    const track = candidates[0];
    const contributors = contributorsFromFields(imported);
    const fallbackRoles = new Set(imported.creditFallbackRoles ?? []);
    applyTrackCredits(data, track, { provider, songId: imported.songId, contributors: contributors.filter(person => !fallbackRoles.has(person.role)), checkedAt });
    applyTrackCredits(data, track, { provider, songId: imported.songId, contributors: contributors.filter(person => fallbackRoles.has(person.role)), checkedAt, fallback: true });
  }
  return validateArchiveData(data);
}

export async function fetchDomesticAlbumCredits(url: string, options: { fetcher?: typeof fetch; signal?: AbortSignal; acquirePermit?: (provider: "melon" | "genie") => Promise<void> } = {}) {
  const identity = canonicalReviewUrl(url);
  let imageUrl: string | null = null;
  let albumHtml = "";
  const baseFetch = options.fetcher ?? fetch;
  const bounded = createReviewUrlFetcher(async (input, init) => {
    options.signal?.throwIfAborted();
    await options.acquirePermit?.(identity.provider);
    options.signal?.throwIfAborted();
    return baseFetch(input, init);
  }, options.signal);
  const fetcher: typeof fetch = async (input, init) => {
    const response = await bounded(input, init);
    if (canonicalReviewUrl(String(input), true).kind === "album" && response.ok) {
      const html = await response.clone().text();
      albumHtml = html;
      imageUrl = domesticAlbumArtwork(html, identity.url);
    }
    return response;
  };
  const album = await (identity.provider === "melon" ? fetchMelonAlbumReviewData : fetchGenieAlbumReviewData)(identity.url, { fetcher, requireLyrics: false, tolerateSongErrors: true, maxTracks: 100 });
  const fallbacks = identity.provider === "genie" ? new Map(parseGenieAlbumCreditFallbacks(albumHtml, parseGenieAlbumPage(albumHtml, album.albumId), new Date().toISOString()).map(update => [update.songId, update])) : new Map<string, DomesticTrackCredits>();
  const tracks = album.tracks.map(track => {
    const fallback = fallbacks.get(track.songId);
    const names = (role: ArchiveContributor["role"]) => fallback?.contributors.filter(person => person.role === role).map(person => person.name).join(", ") ?? "";
    const creditFallbackRoles = ([["composition", track.composer], ["lyrics", track.lyricist], ["arrangement", track.arranger]] as const).flatMap(([role, value]) => !value.trim() && names(role) ? [role] : []);
    return { ...track, composer: track.composer.trim() ? track.composer : names("composition"), lyricist: track.lyricist.trim() ? track.lyricist : names("lyrics"), arranger: track.arranger.trim() ? track.arranger : names("arrangement"), lyrics: "", ...(creditFallbackRoles.length ? { creditFallbackRoles } : {}) };
  });
  // The review-document parser also extracts lyrics. Archive metadata never
  // returns or persists them, including transient worker checkpoint payloads.
  return { album: { ...album, tracks }, provider: identity.provider, imageUrl, partial: album.tracks.some(track => "lyricFetchFailed" in track && track.lyricFetchFailed) };
}

/** Supplement newly imported albums using exact member-owned links only. */
export async function enrichLinkedDomesticAlbums(input: ArchiveData, releaseIds: string[], submissions: CreditSubmission[], libraryId: string, options: { fetcher?: typeof fetch; signal?: AbortSignal; acquirePermit?: (provider: "melon" | "genie") => Promise<void> } = {}) {
  let data = validateArchiveData(input);
  const notices: string[] = [];
  const targetIds = new Set(releaseIds);
  for (const release of data.releases.filter(item => targetIds.has(item.id) && !item.excluded && !item.mergedInto)) {
    const tracks = data.tracks.filter(track => track.releaseId === release.id && !track.excluded && !track.mergedInto);
    const hasCredits = tracks.length > 0 && tracks.every(track => data.recordings.find(recording => recording.id === track.recordingId)?.workIds.some(id => {
      const work = data.works.find(work => work.id === id);
      return work?.userEdited || (work?.contributors?.length && ["melon", "genie"].includes(work.source?.provider ?? ""));
    }));
    if (release.imageUrl && hasCredits) continue;
    const url = linkedDomesticAlbumUrl(data, release.id, submissions, libraryId);
    if (!url) continue;
    try {
      const fetched = await fetchDomesticAlbumCredits(url, options);
      data = mergeDomesticAlbumCredits(data, release.id, fetched.album, fetched.provider, new Date().toISOString(), fetched.imageUrl);
      if (fetched.partial) notices.push(`${release.title}: 일부 저작자 정보를 가져오지 못했습니다. 앨범에서 정보를 다시 가져올 수 있습니다.`);
    } catch {
      // A supplementary site's outage must not roll back catalog tracks or stop import.
      notices.push(`${release.title}: 저작자·자켓 정보를 모두 확인하지 못했습니다. 앨범에서 정보를 다시 가져올 수 있습니다.`);
    }
  }
  return { data, notices };
}
