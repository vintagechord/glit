import { createHash } from "node:crypto";
import { fetchMelonAlbumReviewData, type MelonAlbumReviewData } from "@/lib/melon";
import { fetchGenieAlbumReviewData } from "@/lib/genie";
import { canonicalReviewUrl, createReviewUrlFetcher } from "@/lib/review-docs/urls";
import { safeWebUrlSchema, validateArchiveData, type ArchiveContributor, type ArchiveData } from "./model";
import { parseMusicProviderUrl } from "./providers";
import { matchArchiveReviews } from "./reviews";
import type { CreditSubmission } from "./credits";

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const roleLabels = { lyrics: "작사", composition: "작곡", arrangement: "편곡" };

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

export function mergeDomesticAlbumCredits(input: ArchiveData, releaseId: string, album: MelonAlbumReviewData, provider: "melon" | "genie", checkedAt: string, imageUrl?: string | null): ArchiveData {
  const data = validateArchiveData(input);
  const release = data.releases.find(item => item.id === releaseId);
  if (!release) return data;
  if (imageUrl && safeWebUrlSchema.safeParse(imageUrl).success && (!release.imageUrl || !release.userEdited)) release.imageUrl = imageUrl;
  for (const imported of album.tracks) {
    const candidates = data.tracks.filter(track => track.releaseId === releaseId && !track.excluded && !track.mergedInto && track.trackNumber === imported.trackNo && normalize(track.title) === normalize(imported.trackTitle));
    if (candidates.length !== 1) continue;
    const track = candidates[0];
    const contributors: ArchiveContributor[] = ([['lyrics', imported.lyricist], ['composition', imported.composer], ['arrangement', imported.arranger]] as const).flatMap(([role, value]) => value.split(/[,;\n]/).map(name => name.trim()).filter(Boolean).map(name => ({ name: name.slice(0, 500), role }))).slice(0, 100);
    if (!contributors.length) continue;
    const recordingId = track.recordingId ?? `archive-recording:${hash(track.id)}`;
    let recording = data.recordings.find(item => item.id === recordingId);
    if (!recording) { recording = { id: recordingId, title: track.title, workIds: [] }; data.recordings.push(recording); track.recordingId = recordingId; }
    if (recording.workIds.some(id => data.works.find(work => work.id === id)?.userEdited)) continue;
    const workId = `${provider}-work:${imported.songId}`;
    let work = data.works.find(item => item.id === workId);
    if (work?.userEdited) continue;
    const importedRoles = new Set(contributors.map(item => item.role));
    const refreshedContributors = [...contributors, ...(work?.contributors ?? []).filter(item => !importedRoles.has(item.role))].slice(0, 100);
    const fields = { contributors: refreshedContributors, writers: refreshedContributors.map(item => `${roleLabels[item.role]}: ${item.name}`).join(" · ").slice(0, 500), source: { provider, externalId: imported.songId, checkedAt } };
    if (!work) { work = { id: workId, title: imported.trackTitle, institutionNumbers: [], ...fields }; data.works.push(work); }
    else Object.assign(work, fields);
    // Partial public credits must not erase known roles or detach a saved registration.
    const availableRoles = new Set(refreshedContributors.map(item => item.role));
    recording.workIds = recording.workIds.filter(id => !id.startsWith("onside-work:")
      || data.tasks.some(task => task.workId === id)
      || data.works.find(item => item.id === id)?.contributors?.some(item => !availableRoles.has(item.role)));
    if (!recording.workIds.includes(workId)) recording.workIds.push(workId);
  }
  return validateArchiveData(data);
}

export async function fetchDomesticAlbumCredits(url: string, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}) {
  const identity = canonicalReviewUrl(url);
  let imageUrl: string | null = null;
  const baseFetch = options.fetcher ?? fetch;
  const bounded = createReviewUrlFetcher(baseFetch, options.signal);
  const fetcher: typeof fetch = async (input, init) => {
    const response = await bounded(input, init);
    if (canonicalReviewUrl(String(input), true).kind === "album" && response.ok) {
      const html = await response.clone().text();
      imageUrl = domesticAlbumArtwork(html, identity.url);
    }
    return response;
  };
  const album = await (identity.provider === "melon" ? fetchMelonAlbumReviewData : fetchGenieAlbumReviewData)(identity.url, { fetcher, requireLyrics: false, tolerateSongErrors: true, maxTracks: 100 });
  return { album, provider: identity.provider, imageUrl, partial: album.tracks.some(track => "lyricFetchFailed" in track && track.lyricFetchFailed) };
}

/** Supplement newly imported albums using exact member-owned links only. */
export async function enrichLinkedDomesticAlbums(input: ArchiveData, releaseIds: string[], submissions: CreditSubmission[], libraryId: string, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}) {
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
