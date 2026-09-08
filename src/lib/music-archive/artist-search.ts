/** Pure ranking of actual public-provider candidates. This module has no shared cache. */
export type SearchableArtistCandidate = {
  provider: string;
  externalId: string;
  name: string;
  sortName?: string;
  aliases?: readonly string[];
  url?: string;
};

const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const leadingJamo = "ᄀᄁᄂᄃᄄᄅᄆᄇᄈᄉᄊᄋᄌᄍᄎᄏᄐᄑᄒ";
const marks = new RegExp("\\p{M}", "gu");
const separators = new RegExp("[^\\p{L}\\p{N}]", "gu");

/** Keep Hangul syllables, normalize compatibility/jamo forms, and ignore spacing/punctuation. */
export function normalizeArtistSearchText(value: string): string {
  // Removing accent marks makes a public name such as ROSÉ searchable as "rose".
  // Hangul NFD components are letters, so NFC subsequently restores whole syllables.
  const normalized = value.normalize("NFKC").normalize("NFD").replace(marks, "").normalize("NFC").toLowerCase();
  return Array.from(normalized, character => {
    const index = leadingJamo.indexOf(character);
    return index >= 0 ? initials[index] : character;
  }).join("").replace(separators, "");
}

/** Non-Hangul letters/numbers remain intact rather than being guessed as Korean sounds. */
export function getArtistInitials(value: string): string {
  return Array.from(normalizeArtistSearchText(value), character => {
    const code = character.codePointAt(0)!;
    return code >= 0xac00 && code <= 0xd7a3 ? initials[Math.floor((code - 0xac00) / 588)] : character;
  }).join("");
}

export function isInitialConsonantQuery(query: string): boolean {
  const normalized = normalizeArtistSearchText(query);
  return !!normalized && Array.from(normalized).every(character => initials.includes(character));
}

function publicCandidateNames(candidate: SearchableArtistCandidate): string[] {
  const names = [candidate.name, candidate.sortName, ...(candidate.aliases ?? [])].filter((name): name is string => typeof name === "string" && !!name.trim());
  if (candidate.provider === "apple" && candidate.url) {
    try {
      const url = new URL(candidate.url);
      // Apple KR artist links can contain the public Korean name while artistName is English.
      // Accept only the official artist path for this very same provider ID.
      const match = url.pathname.match(/^\/kr\/artist\/([^/]+)\/(\d+)\/?$/);
      if (url.protocol === "https:" && url.hostname === "music.apple.com" && !url.username && !url.password && !url.port && match?.[2] === candidate.externalId) {
        const slug = decodeURIComponent(match[1]).normalize("NFKC");
        if (/[가-힣]/.test(slug)) names.push(slug.replace(/[-_]+/g, " "));
      }
    } catch { /* A malformed URL does not invalidate otherwise usable public names. */ }
  }
  return [...new Set(names)];
}

export type ArtistSearchMatch = {
  kind: "exact" | "prefix" | "initial_prefix";
  score: 300 | 200 | 100;
  matchedName: string;
};

/** Compare only real provider names/aliases, never member notes or disambiguation text. */
export function matchArtistCandidate(candidate: SearchableArtistCandidate, query: string): ArtistSearchMatch | null {
  const wanted = normalizeArtistSearchText(query);
  if (!wanted) return null;
  const initialQuery = isInitialConsonantQuery(wanted);
  let best: ArtistSearchMatch | null = null;
  for (const name of publicCandidateNames(candidate)) {
    const normalized = normalizeArtistSearchText(name);
    if (!normalized) continue;
    let match: ArtistSearchMatch | null = null;
    if (normalized === wanted) match = { kind: "exact", score: 300, matchedName: name };
    else if (normalized.startsWith(wanted)) match = { kind: "prefix", score: 200, matchedName: name };
    else if (initialQuery && getArtistInitials(name).startsWith(wanted)) match = { kind: "initial_prefix", score: 100, matchedName: name };
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best;
}

/**
 * Callers supply validated public API candidates. No names are learned or persisted here.
 * Exact names precede full-name prefixes, then Korean initial prefixes. Ties retain provider order.
 * Duplicate provider/ID pairs retain the strongest matching real candidate; providers stay distinct.
 */
export function rankArtistCandidates<T extends SearchableArtistCandidate>(candidates: readonly T[], query: string, limit = 20): T[] {
  const cap = Number.isFinite(limit) ? Math.min(20, Math.max(0, Math.floor(limit))) : 20;
  if (!cap || !normalizeArtistSearchText(query)) return [];
  const matches = new Map<string, { candidate: T; match: ArtistSearchMatch; index: number }>();
  candidates.forEach((candidate, index) => {
    const match = matchArtistCandidate(candidate, query);
    if (!match) return;
    const key = JSON.stringify([candidate.provider, candidate.externalId]);
    const previous = matches.get(key);
    if (!previous || match.score > previous.match.score) matches.set(key, { candidate, match, index });
  });
  return [...matches.values()].sort((left, right) => right.match.score - left.match.score || left.index - right.index).slice(0, cap).map(entry => entry.candidate);
}
