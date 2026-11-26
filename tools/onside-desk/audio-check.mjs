// 음원 ↔ 가사 대조의 판단 로직(순수 함수). import 시 부작용이 없다.
import { createHash } from 'node:crypto';

export const THRESHOLDS = {
  strongDelta: 8,
  mediumDelta: 2,
  repeatSimilarity: 0.75,
  minGapChars: 6,
  mergeGap: 2,
  vocalDb: -15,
  unclearSec: 2.5,
  holdSec: 1.5,
  hallucinationDb: -35,
  repeatWords: 6,
  mrVocalRatio: 0.15,
  mrResidualDb: -12,
  mrDurationSec: 0.5,
  foreignRatio: 0.4,
};

export const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg']);
const LOSSLESS = new Set(['wav', 'flac', 'aif', 'aiff']);
const MR_SUFFIX = /\((?:MR|Inst\.?|Instrumental)\)\s*$/i;
const TRANSLATION_LINE = /^\s*\(\s*번역\s*[:：]/;

export function lyricsHash(lyrics) {
  return createHash('sha256').update(String(lyrics ?? ''), 'utf8').digest('hex');
}

const KEEP = /[가-힣ㄱ-ㅎㅏ-ㅣa-z0-9]/;

export function normalizeText(text) {
  const src = String(text ?? '');
  let norm = '';
  const map = [];
  for (let i = 0; i < src.length; i += 1) {
    const lower = src[i].toLowerCase();
    for (const ch of lower) {
      if (KEEP.test(ch)) {
        norm += ch;
        map.push(i);
      }
    }
  }
  return { norm, map };
}

export function lyricLines(lyrics) {
  return String(lyrics ?? '')
    .split('\n')
    .map((text, index) => ({
      index,
      text,
      norm: normalizeText(text).norm,
      translation: TRANSLATION_LINE.test(text),
    }));
}

export function foreignRatio(lyrics) {
  let latin = 0;
  let hangul = 0;
  for (const line of lyricLines(lyrics)) {
    if (line.translation) continue;
    for (const ch of line.norm) {
      if (/[a-z]/.test(ch)) latin += 1;
      else if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch)) hangul += 1;
    }
  }
  const total = latin + hangul;
  return total === 0 ? 0 : latin / total;
}

export function similarity(a, b) {
  const x = Array.from(String(a ?? ''));
  const y = Array.from(String(b ?? ''));
  if (x.length + y.length === 0) return 1;
  let prev = new Uint32Array(y.length + 1);
  let cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return (2 * prev[y.length]) / (x.length + y.length);
}

const MATCH = 2;
const JAMO = 1;
const MISMATCH = -1;
const GAP_OPEN = -3;
const GAP_EXT = -0.5;
const NEG = -1e9;

function hangulParts(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return [Math.floor(c / 588), Math.floor((c % 588) / 28)];
}

function pairScore(p, q) {
  if (p === q) return MATCH;
  const pp = hangulParts(p);
  const qq = hangulParts(q);
  if (pp && qq && pp[0] === qq[0] && pp[1] === qq[1]) return JAMO;
  return MISMATCH;
}

// Gotoh 전역 정렬. 쌍 [i, j]: i는 a 위치(갭이면 null), j는 b 위치(갭이면 null).
export function alignChars(a, b) {
  const x = Array.from(String(a ?? ''));
  const y = Array.from(String(b ?? ''));
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const size = (n + 1) * w;
  const M = new Float64Array(size).fill(NEG); // a[i-1]와 b[j-1]을 짝지음
  const X = new Float64Array(size).fill(NEG); // b[j-1]만 있음(a에 갭)
  const Y = new Float64Array(size).fill(NEG); // a[i-1]만 있음(b에 갭)
  M[0] = 0;
  for (let j = 1; j <= m; j += 1) X[j] = GAP_OPEN + (j - 1) * GAP_EXT;
  for (let i = 1; i <= n; i += 1) Y[i * w] = GAP_OPEN + (i - 1) * GAP_EXT;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const k = i * w + j;
      const d = (i - 1) * w + (j - 1);
      M[k] = pairScore(x[i - 1], y[j - 1]) + Math.max(M[d], X[d], Y[d]);
      const l = k - 1;
      X[k] = Math.max(M[l] + GAP_OPEN, X[l] + GAP_EXT, Y[l] + GAP_OPEN);
      const u = k - w;
      Y[k] = Math.max(M[u] + GAP_OPEN, Y[u] + GAP_EXT, X[u] + GAP_OPEN);
    }
  }
  let i = n;
  let j = m;
  const end = n * w + m;
  let state = 'M';
  let best = M[end];
  if (X[end] > best) { best = X[end]; state = 'X'; }
  if (Y[end] > best) { best = Y[end]; state = 'Y'; }
  if (n === 0 && m === 0) return [];
  const out = [];
  while (i > 0 || j > 0) {
    const k = i * w + j;
    if (state === 'M') {
      out.push([i - 1, j - 1]);
      const d = k - w - 1;
      const target = M[k] - pairScore(x[i - 1], y[j - 1]);
      i -= 1; j -= 1;
      state = M[d] === target ? 'M' : X[d] === target ? 'X' : 'Y';
    } else if (state === 'X') {
      out.push([null, j - 1]);
      const l = k - 1;
      const target = X[k];
      j -= 1;
      state = M[l] + GAP_OPEN === target ? 'M' : X[l] + GAP_EXT === target ? 'X' : 'Y';
    } else {
      out.push([i - 1, null]);
      const u = k - w;
      const target = Y[k];
      i -= 1;
      state = M[u] + GAP_OPEN === target ? 'M' : Y[u] + GAP_EXT === target ? 'Y' : 'X';
    }
  }
  return out.reverse();
}

function extOf(name) {
  const m = /\.([^.\\/]+)$/.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
}

function isAudio(attachment) {
  return AUDIO_EXTENSIONS.has(extOf(attachment?.name));
}

function baseName(name) {
  return String(name ?? '').replace(/\.[^.\\/]+$/, '');
}

function leadingNumber(name) {
  const m = /^0?(\d{1,2})[ ._\-)]/.exec(String(name ?? ''));
  return m ? Number(m[1]) : null;
}

export function autoMapping(tracks, attachments) {
  const trackList = Array.isArray(tracks) ? tracks : [];
  const audio = (Array.isArray(attachments) ? attachments : []).filter(isAudio);
  const candidates = new Map(trackList.map((t) => [t.id, []]));
  const titleNorm = new Map(trackList.map((t) => [t.id, normalizeText(t.track_title).norm]));

  for (const file of audio) {
    const number = leadingNumber(file.name);
    let owner = null;
    if (number !== null) {
      owner = trackList.find((t) => Number(t.track_no) === number) ?? null;
    }
    if (!owner) {
      const fileNorm = normalizeText(baseName(file.name)).norm;
      let bestLen = 0;
      for (const t of trackList) {
        const tn = titleNorm.get(t.id);
        if (!tn || !fileNorm) continue;
        if (fileNorm.includes(tn) || tn.includes(fileNorm)) {
          const len = Math.min(tn.length, fileNorm.length);
          if (len > bestLen) { bestLen = len; owner = t; }
        }
      }
    }
    if (owner) candidates.get(owner.id).push(file);
  }

  const mapping = {};
  const duplicates = [];
  const used = new Set();
  for (const t of trackList) {
    const list = candidates.get(t.id);
    if (!list.length) { mapping[t.id] = null; continue; }
    const rank = (f) => (LOSSLESS.has(extOf(f.name)) ? 0 : 1);
    const sorted = [...list].sort((p, q) => rank(p) - rank(q));
    mapping[t.id] = sorted[0].id;
    used.add(sorted[0].id);
    for (const dup of sorted.slice(1)) {
      duplicates.push({ trackId: t.id, attachmentId: dup.id });
      used.add(dup.id);
    }
  }

  const mrPairs = {};
  for (const t of trackList) {
    const title = String(t.track_title ?? '');
    if (!MR_SUFFIX.test(title)) continue;
    const base = normalizeText(title.replace(MR_SUFFIX, '')).norm;
    if (!base) continue;
    const vocal = trackList.find(
      (v) => v.id !== t.id && !MR_SUFFIX.test(String(v.track_title ?? '')) && titleNorm.get(v.id) === base,
    );
    if (vocal) mrPairs[t.id] = vocal.id;
  }

  const unmapped = audio.filter((f) => !used.has(f.id)).map((f) => f.id);
  return { mapping, duplicates, mrPairs, unmapped };
}

export function validateMapping(mapping, tracks, attachments) {
  const trackIds = new Set((tracks ?? []).map((t) => t.id));
  const byId = new Map((attachments ?? []).map((a) => [a.id, a]));
  const seen = new Map();
  for (const [trackId, attachmentId] of Object.entries(mapping ?? {})) {
    if (!trackIds.has(trackId)) throw new Error(`알 수 없는 트랙입니다: ${trackId}`);
    if (attachmentId === null || attachmentId === undefined) continue;
    const file = byId.get(attachmentId);
    if (!file) throw new Error(`알 수 없는 음원 파일입니다: ${attachmentId}`);
    if (!isAudio(file)) throw new Error(`오디오 파일이 아닙니다: ${file.name}`);
    if (seen.has(attachmentId)) {
      throw new Error(`같은 음원을 두 트랙에 연결할 수 없습니다: ${file.name}`);
    }
    seen.set(attachmentId, trackId);
  }
}
