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
    const fields = { contributors, writers: contributors.map(item => `${roleLabels[item.role]}: ${item.name}`).join(" · ").slice(0, 500), source: { provider, externalId: imported.songId, checkedAt } };
    if (!work) { work = { id: workId, title: imported.trackTitle, institutionNumbers: [], ...fields }; data.works.push(work); }
    else Object.assign(work, fields);
    // Keep other source metadata; one exact domestic work replaces earlier reused submission credits.
    recording.workIds = recording.workIds.filter(id => !id.startsWith("onside-work:"));
    if (!recording.workIds.includes(workId)) recording.workIds.push(workId);
  }
  return validateArchiveData(data);
}

export async function fetchDomesticAlbumCredits(url: string, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}) {
  const identity = canonicalReviewUrl(url);
  let imageUrl: string | null = null;
  const baseFetch = options.fetcher ?? fetch;
  const bounded = createReviewUrlFetcher(((input, init) => baseFetch(input, { ...init, signal: options.signal ? AbortSignal.any([options.signal, ...(init?.signal ? [init.signal] : [])]) : init?.signal })) as typeof fetch);
  const fetcher: typeof fetch = async (input, init) => {
    const response = await bounded(input, init);
    if (canonicalReviewUrl(String(input), true).kind === "album" && response.ok) {
      const html = await response.clone().text();
      for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
        const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
        if ((attributes.property ?? attributes.name)?.toLowerCase() !== "og:image") continue;
        const value = attributes.content?.replaceAll("&amp;", "&");
        try {
          const image = new URL(value, url); image.protocol = "https:";
          const hosts = identity.provider === "melon" ? ["melon.com", "melon.co.kr"] : ["genie.co.kr"];
          if (safeWebUrlSchema.safeParse(image.toString()).success && hosts.some(host => image.hostname === host || image.hostname.endsWith(`.${host}`))) imageUrl = image.toString();
        } catch { /* A missing thumbnail does not discard track credits. */ }
      }
    }
    return response;
  };
  const album = await (identity.provider === "melon" ? fetchMelonAlbumReviewData : fetchGenieAlbumReviewData)(identity.url, { fetcher, requireLyrics: false, tolerateSongErrors: true, maxTracks: 100 });
  return { album, provider: identity.provider, imageUrl, partial: album.tracks.some(track => "lyricFetchFailed" in track && track.lyricFetchFailed) };
}
