// 음원 ↔ 가사 대조의 판단 로직(순수 함수). import 시 부작용이 없다.
import { createHash } from 'node:crypto';

export const THRESHOLDS = {
  strongDelta: 8,
  mediumDelta: 2,
  repeatSimilarity: 0.75,
  remapSimilarity: 0.55,
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
  noVocalRatio: 0.05,
  vocalSecPerChar: 0.15,
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
  const titleNorm = new Map(trackList.map((t) => [t.id, normalizeText(String(t.track_title ?? '').normalize('NFC')).norm]));

  for (const file of audio) {
    const number = leadingNumber(file.name);
    let owner = null;
    if (number !== null) {
      owner = trackList.find((t) => Number(t.track_no) === number) ?? null;
    }
    if (!owner) {
      const fileNorm = normalizeText(baseName(file.name).normalize('NFC')).norm;
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
    const title = String(t.track_title ?? '').normalize('NFC');
    if (!MR_SUFFIX.test(title)) continue;
    const base = normalizeText(title.normalize('NFC').replace(MR_SUFFIX, '')).norm;
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

// ── 받아쓰기 정리와 제안 ──────────────────────────────────────────────
// segments: [{ s, e, t, words: [{ s, e, w }] }], energy[k]: 프레임 [k·hop, (k+1)·hop)의 보컬 dB(보컬 스템 자신의 90퍼센타일 기준),
// level[k]: 같은 프레임의 보컬 dB(분리 전 믹스의 90퍼센타일 기준, 보컬이 있는지 판단용)

const HALLUCINATION = /(감사합니다|시청해 ?주셔서|다음 영상|한글자막|자막 ?by|구독|아멘)/;
const HOP = 0.25;
const MIN_SEGMENT_SEC = 0.3;
const SNAP_CHARS = 3;
const WHOLE_LINE = 0.9;
const SCORE_PAD_SEC = 0.5;
const SCORE_MAX_SEC = 30;

const round = (x) => Math.round(x * 100) / 100;
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

function frameRange(start, end, hop, length) {
  const k0 = Math.max(0, Math.floor(start / hop));
  const k1 = Math.min(length, Math.max(k0 + 1, Math.ceil(end / hop)));
  return [k0, k1];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function longestWordRun(text) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const word of String(text ?? '').split(/\s+/)) {
    const w = normalizeText(word).norm;
    if (!w) continue;
    run = w === prev ? run + 1 : 1;
    prev = w;
    best = Math.max(best, run);
  }
  return best;
}

export function cleanTranscript(segments, energy, hop = HOP) {
  const en = Array.isArray(energy) ? energy : [];
  return (Array.isArray(segments) ? segments : []).filter((seg) => {
    const text = String(seg?.t ?? '');
    if (HALLUCINATION.test(text)) return false;
    if (!(seg.e - seg.s >= MIN_SEGMENT_SEC)) return false;
    const [k0, k1] = frameRange(seg.s, seg.e, hop, en.length);
    const level = median(en.slice(k0, k1));
    if (level !== null && level < THRESHOLDS.hallucinationDb) return false;
    return longestWordRun(text) <= THRESHOLDS.repeatWords;
  });
}

const spread = (s, e, k, n) => [s + ((e - s) * k) / n, s + ((e - s) * (k + 1)) / n];

// 글자마다 시각: 낱말 시각을 글자 수로 나눈다. 낱말이 없거나 글자가 안 맞으면 구간 시각을 고르게 나눈다.
function charTimes(seg, count) {
  const out = [];
  for (const word of Array.isArray(seg.words) ? seg.words : []) {
    const n = normalizeText(word.w).norm.length;
    for (let k = 0; k < n; k += 1) out.push(spread(word.s, word.e, k, n));
  }
  if (out.length === count) return out;
  return Array.from({ length: count }, (_, k) => spread(seg.s, seg.e, k, count));
}

function transcriptChars(segments) {
  const T = { text: '', norm: '', s: [], e: [], off: [], seg: [] };
  segments.forEach((seg, index) => {
    const t = String(seg.t ?? '').trim();
    if (T.text) T.text += ' ';
    const base = T.text.length;
    T.text += t;
    const { norm, map } = normalizeText(t);
    const times = charTimes(seg, norm.length);
    for (let k = 0; k < norm.length; k += 1) {
      T.norm += norm[k];
      T.s.push(times[k][0]);
      T.e.push(times[k][1]);
      T.off.push(base + map[k]);
      T.seg.push(index);
    }
  });
  return T;
}

// 번역 줄을 뺀 가사 글자열. 글자마다 줄 번호와 줄 안 원문 위치를 둔다.
function lyricChars(lines) {
  const L = { norm: '', line: [], off: [], span: new Map() };
  for (const line of lines) {
    if (line.translation) continue;
    const { norm, map } = normalizeText(line.text);
    if (norm) L.span.set(line.index, [L.norm.length, L.norm.length + norm.length - 1]);
    for (let k = 0; k < norm.length; k += 1) {
      L.norm += norm[k];
      L.line.push(line.index);
      L.off.push(map[k]);
    }
  }
  return L;
}

// 같은 점수의 갭 위치 중에서 고른다: 긴 갭은 줄 경계에, 짧은 삽입은 줄 안쪽에 둔다(없으면 가장 오른쪽).
function slideGaps(pairs, L, T) {
  const seqs = [L.norm, T.norm];
  const n = L.norm.length;
  const exact = (p) => p !== undefined && p[0] !== null && p[1] !== null && seqs[0][p[0]] === seqs[1][p[1]];
  const edge = (q) => q <= 0 || q >= n || L.line[q - 1] !== L.line[q];
  let before = 0;
  let p = 0;
  while (p < pairs.length) {
    const has = pairs[p][0] === null ? 1 : pairs[p][1] === null ? 0 : -1;
    if (has < 0) { before += 1; p += 1; continue; }
    const other = 1 - has;
    let p1 = p;
    while (p1 + 1 < pairs.length && pairs[p1 + 1][other] === null) p1 += 1;
    const g = p1 - p + 1;
    const g0 = pairs[p][has];
    const own = seqs[has];
    const opp = seqs[other];
    let right = 0;
    while (exact(pairs[p1 + 1 + right]) && own[g0 + right] === opp[pairs[p1 + 1 + right][other]]) right += 1;
    let left = 0;
    while (exact(pairs[p - 1 - left]) && own[g0 + g - 1 - left] === opp[pairs[p - 1 - left][other]]) left += 1;
    const aligned = (s) => (has === 1 ? edge(before + s) : edge(g0 + s) && edge(g0 + s + g));
    const want = g >= THRESHOLDS.minGapChars ? aligned : has === 1 ? (s) => !aligned(s) : null;
    let shift = right;
    if (want) {
      for (let s = right; s >= -left; s -= 1) {
        if (want(s)) { shift = s; break; }
      }
    }
    if (shift !== 0) moveRun(pairs, p, p1, has, shift);
    const from = Math.min(p, p + shift);
    const next = Math.max(p1, p1 + shift) + 1;
    before = shift < 0 ? before + shift : before;
    for (let k = from; k < next; k += 1) if (pairs[k][0] !== null) before += 1;
    p = next;
  }
}

function moveRun(pairs, p0, p1, has, shift) {
  const other = 1 - has;
  const g = p1 - p0 + 1;
  const g0 = pairs[p0][has];
  const mk = (h, o) => (has === 1 ? [o, h] : [h, o]);
  const out = [];
  if (shift > 0) {
    const o0 = pairs[p1 + 1][other];
    for (let r = 0; r < shift; r += 1) out.push(mk(g0 + r, o0 + r));
    for (let r = 0; r < g; r += 1) out.push(mk(g0 + shift + r, null));
    pairs.splice(p0, g + shift, ...out);
  } else {
    const k = -shift;
    const o0 = pairs[p0 - k][other];
    for (let r = 0; r < g; r += 1) out.push(mk(g0 - k + r, null));
    for (let r = 0; r < k; r += 1) out.push(mk(g0 - k + g + r, o0 + r));
    pairs.splice(p0 - k, g + k, ...out);
  }
}

// 일치가 아닌 칸을 모으고 일치 mergeGap자 이하로 떨어진 구간은 합친다. minGapChars 이상인 한쪽 갭은 따로 둔다.
function diffRegions(pairs, a, b) {
  const kindOf = ([i, j]) => (i === null ? 'ins' : j === null ? 'del' : a[i] === b[j] ? 'm' : 'sub');
  const runs = [];
  pairs.forEach((pair, p) => {
    const kind = kindOf(pair);
    const last = runs.at(-1);
    if (last && last.kind === kind) last.p1 = p;
    else runs.push({ kind, p0: p, p1: p });
  });
  const regions = [];
  let cur = null;
  for (const run of runs) {
    if (run.kind === 'm') continue;
    if (run.kind !== 'sub' && run.p1 - run.p0 + 1 >= THRESHOLDS.minGapChars) {
      if (cur) regions.push(cur);
      cur = null;
      regions.push({ p0: run.p0, p1: run.p1 });
    } else if (cur && run.p0 - cur.p1 - 1 <= THRESHOLDS.mergeGap) {
      cur.p1 = run.p1;
    } else {
      if (cur) regions.push(cur);
      cur = { p0: run.p0, p1: run.p1 };
    }
  }
  if (cur) regions.push(cur);
  return regions;
}

function neighbor(pairs, p, side, step) {
  for (let k = p; k >= 0 && k < pairs.length; k += step) if (pairs[k][side] !== null) return pairs[k][side];
  return -1;
}

// 받아쓴 글자를 구간별 원문 줄로(낱말 경계까지 넓힌다).
function heardLines(T, tj) {
  const bySeg = new Map();
  for (const j of tj) {
    if (bySeg.has(T.seg[j])) bySeg.get(T.seg[j])[1] = j;
    else bySeg.set(T.seg[j], [j, j]);
  }
  const out = [];
  for (const [j0, j1] of bySeg.values()) {
    let c = T.off[j0];
    let d = T.off[j1] + 1;
    while (c > 0 && !/\s/.test(T.text[c - 1])) c -= 1;
    while (d < T.text.length && !/\s/.test(T.text[d])) d += 1;
    const piece = T.text.slice(c, d).trim();
    if (piece) out.push(piece);
  }
  return out;
}

// 가사 글자 [i0, i1]의 원문을 줄마다 잘라 돌려준다.
function lyricPieces(ctx, i0, i1) {
  const { L, lines } = ctx;
  const out = [];
  for (let x = L.line[i0]; x <= L.line[i1]; x += 1) {
    if (lines[x].translation) continue;
    const a = x === L.line[i0] ? L.off[i0] : 0;
    const b = x === L.line[i1] ? L.off[i1] + 1 : lines[x].text.length;
    const piece = lines[x].text.slice(a, b).trim();
    if (piece) out.push(piece);
  }
  return out;
}

// 줄 다음에 딸린 번역 줄까지 포함한 마지막 줄 번호
function lineAfter(lines, index) {
  let k = index;
  while (lines[k + 1]?.translation) k += 1;
  return k;
}

// G 전체를 P 안의 가장 비슷한 부분 문자열에 맞춘 정렬 경로(P 양끝 자유). 같은 점수면 near 바로 앞에서 끝나는 것을 고른다.
// 칸마다 [종류, P 위치, G 위치]: 'm' 일치, 'x' 불일치, 'p' P 글자만(G 위치 −1), 'g' G 글자만(P 위치 −1).
function alignPath(G, P, near) {
  const g = G.length;
  const n = P.length;
  const w = n + 1;
  const D = new Int32Array((g + 1) * w);
  for (let i = 1; i <= g; i += 1) {
    D[i * w] = -i;
    for (let j = 1; j <= n; j += 1) {
      const k = i * w + j;
      D[k] = Math.max(D[k - w - 1] + (G[i - 1] === P[j - 1] ? 1 : -1), D[k - w] - 1, D[k - 1] - 1);
    }
  }
  const rank = (j) => (j <= near ? near - j : n + j - near);
  let end = 0;
  for (let j = 1; j <= n; j += 1) {
    const v = D[g * w + j];
    const b = D[g * w + end];
    if (v > b || (v === b && rank(j) < rank(end))) end = j;
  }
  let i = g;
  let j = end;
  const path = [];
  while (i > 0) {
    const k = i * w + j;
    const same = j > 0 && G[i - 1] === P[j - 1];
    if (j > 0 && D[k] === D[k - w - 1] + (same ? 1 : -1)) {
      path.push([same ? 'm' : 'x', j - 1, i - 1]);
      i -= 1;
      j -= 1;
    } else if (j > 0 && D[k] === D[k - 1] - 1) {
      path.push(['p', j - 1, -1]);
      j -= 1;
    } else {
      path.push(['g', -1, i - 1]);
      i -= 1;
    }
  }
  return path.reverse();
}

const LINE_COVERAGE = 0.5;
const CHAR_JAMO = 0.5;

const jamoSimilarity = (a, b) => similarity(jamo(a).join(''), jamo(b).join(''));

// 받아쓴 글자 h가 가사 글자 p를 덮는지(같거나 자모가 비슷한 글자)
const covers = (h, p) => h === p || jamoSimilarity(h, p) >= CHAR_JAMO;

// 정렬 경로 칸이 덮은 가사 글자인지(정확히 맞았거나 자모가 비슷한 글자)
const coversChar = (G, P, [kind, j, i]) => kind === 'm' || (kind === 'x' && covers(G[i], P[j]));

// 정렬 경로에서 점수가 가장 높은 연속 구간(core, 일치 +1·나머지 −1). [첫 칸, 끝 칸](둘 다 일치) 또는 null.
// core 밖의 뭉개진 구간은 블록(빈 줄로 나뉜 연) 안쪽일 때만 넘는다: 그 너머의 정확히 맞은 글자가 일치와 나머지를 같은 수로
// 갚고, 새로 닿은 같은 연의 다른 줄을 모두 절반 이상 덮거나('오 그대여 | 파타 뭘니 가거라…'), 다른 줄에 닿지 않으면
// core만으로는 절반이 안 덮이던 가장자리 줄을 절반 이상 덮으면서 그 줄의 처음(끝)까지 맞아야 한다('바다 멀리 까꺼나 처
// 하늘 끝까지'). 블록 안쪽이 뭉개져 core가 둘로 갈린 경우다. 이미 들어갈 줄에 글자만 더하거나 줄 가운데에서 우연히 맞은
// 글자, 다른 연의 글자로는 넓히지 않는다(후렴을 끝까지 부르지 않고 이어 부른 다른 노래의 첫 낱말, 앞뒤 애드리브).
function bestRun(path, G, ctx) {
  const { L, stanza } = ctx;
  let best = 0;
  let from = 0;
  let to = -1;
  let run = 0;
  let runFrom = 0;
  path.forEach(([kind], k) => {
    if (run <= 0) { run = 0; runFrom = k; }
    run += kind === 'm' ? 1 : -1;
    if (run > best) { best = run; from = runFrom; to = k; }
  });
  if (to < 0) return null;
  const lineOf = (k) => (path[k][1] >= 0 ? L.line[path[k][1]] : -1);
  const half = (x) => LINE_COVERAGE * (L.span.get(x)[1] - L.span.get(x)[0] + 1);
  const inCore = new Map();
  for (let k = from; k <= to; k += 1) {
    if (lineOf(k) >= 0 && coversChar(G, L.norm, path[k])) inCore.set(lineOf(k), (inCore.get(lineOf(k)) ?? 0) + 1);
  }
  const reach = (edge, step) => {
    const own = lineOf(edge);
    const ownBefore = inCore.get(own) ?? 0;
    const hits = new Map();
    let last = edge;
    let sum = 0;
    for (let k = edge + step; k >= 0 && k < path.length; k += step) {
      const x = lineOf(k);
      if (x >= 0 && stanza[x] !== stanza[own]) break;
      sum += path[k][0] === 'm' ? 1 : -1;
      if (x >= 0) hits.set(x, (hits.get(x) ?? 0) + (coversChar(G, L.norm, path[k]) ? 1 : 0));
      if (sum !== 0 || path[k][0] !== 'm') continue;
      const others = [...hits].filter(([y]) => y !== own);
      const ownNow = ownBefore + (hits.get(own) ?? 0);
      const lineEdge = path[k][1] === L.span.get(own)[step < 0 ? 0 : 1];
      const completes = others.length > 0 || (lineEdge && ownBefore < half(own) && ownNow >= half(own));
      if (completes && others.every(([y, c]) => c >= half(y))) last = k;
    }
    return last;
  };
  return [reach(from, -1), reach(to, 1)];
}

// 받아쓴 구간 tj에서 가사의 반복 블록을 찾는다. 맞춘 구간은 정렬 경로의 core(점수가 가장 높은 연속 구간, 양끝이 정확히 맞은
// 글자)뿐이다: 그 밖의 받아쓴 글자는 뭉개진 끝자락이든 다른 노래든 글로는 가릴 수 없으므로 반복 구절에 넣지 않는다.
// 맞춘 구간으로 유사도를 보고, 줄마다 덮인 비율(정확히 맞은 글자 + 자모가 비슷한 글자)이 LINE_COVERAGE 이상인 줄만
// 블록에 넣는다(줄 중간에서 자르지 않는다). 덮인 줄이 하나도 없는 블록(빈 줄로 나뉜 연)의 줄은 core가 걸쳤어도 반복 구절 밖이고
// 거기 맞춘 받아쓴 글자는 남은 앞·뒤로 본다(앞뒤 애드리브가 이웃 연의 한두 글자에 맞은 경우). 반복 구절의 블록 안에서 core가
// 걸친 줄이 모두 들어가면 강함, 하나라도 빠지면(가장자리 줄 포함) 덮인 줄만 보통. 한 줄 안의 일부만 다시 부른 메아리는
// 가사 표기 조각으로 보통.
// 돌려주는 g0, g1은 반복 구절에 해당하는 tj 안의 받아쓴 범위다(나머지는 gapFindings가 따로 본다). whole은 lines가 모두
// 온전한 가사 줄이고 그 사이에 빠진 줄이 없는지다(강함은 늘 whole, 줄 일부만 다시 부른 메아리는 아니다).
function findRepeat(ctx, tj, near) {
  const { L, T, lines, stanza } = ctx;
  const G = tj.map((j) => T.norm[j]).join('');
  if (!G.length || !L.norm.length) return null;
  const path = alignPath(G, L.norm, near);
  const core = bestRun(path, G, ctx);
  if (!core) return null;
  const [lo, hi] = core;
  const s = path[lo][1];
  const e = path[hi][1] + 1;
  const gs = path[lo][2];
  const ge = path[hi][2] + 1;
  const covered = new Uint8Array(L.norm.length);
  for (let k = lo; k <= hi; k += 1) if (coversChar(G, L.norm, path[k])) covered[path[k][1]] = 1;
  if (ge - gs < THRESHOLDS.minGapChars) return null;
  if (similarity(G.slice(gs, ge), L.norm.slice(s, e)) < THRESHOLDS.repeatSimilarity) return null;
  const touched = [];
  for (let x = L.line[s]; x <= L.line[e - 1]; x += 1) if (L.span.has(x)) touched.push(x);
  const coverage = (x) => {
    const [a, b] = L.span.get(x);
    let c = 0;
    for (let p = a; p <= b; p += 1) c += covered[p];
    return c / (b - a + 1);
  };
  const kept = touched.filter((x) => coverage(x) >= LINE_COVERAGE);
  const inside = kept.length ? touched.filter((x) => stanza[x] >= stanza[kept[0]] && stanza[x] <= stanza[kept.at(-1)]) : touched;
  // 블록 안에서 core가 걸친 줄을 하나라도 뺐으면(가장자리 포함) 블록이 어디까지인지 확실하지 않으므로 강함으로 두지 않는다.
  const whole = kept.length === inside.length;
  // 줄을 뺐거나 블록 밖 줄에 걸쳤으면 받아쓴 범위도 남은 줄까지로 줄인다.
  const heardIn = (a, b) => {
    let i0 = Infinity;
    let i1 = -Infinity;
    for (let k = lo; k <= hi; k += 1) {
      const [kind, j, i] = path[k];
      if ((kind === 'm' || kind === 'x') && j >= a && j <= b) { i0 = Math.min(i0, i); i1 = Math.max(i1, i + 1); }
    }
    return [i0, i1];
  };
  const highBlock = (first, last, g0, g1) => {
    const block = lines.slice(first, lineAfter(lines, last) + 1).map((line) => line.text);
    if (first > 0 && lines[first - 1].text.trim() === '') block.unshift('');
    return { confidence: 'high', lines: block, la: first, lb: last, g0, g1, whole: true };
  };
  if (inside.length === 1 || kept.length === 1) {
    const x = kept[0] ?? inside[0];
    const [a, b] = L.span.get(x);
    const g0 = x === L.line[s] ? gs : heardIn(a, b)[0];
    const g1 = x === L.line[e - 1] ? ge : heardIn(a, b)[1];
    if (whole && coverage(x) >= WHOLE_LINE) return highBlock(x, x, g0, g1);
    const p0 = Math.max(s, a);
    const p1 = Math.min(e, b + 1);
    return { confidence: 'medium', lines: lyricPieces(ctx, p0, p1 - 1), la: x, lb: x, g0, g1, whole: p0 === a && p1 === b + 1 };
  }
  if (!kept.length) return null;
  const first = kept[0];
  const last = kept.at(-1);
  const g0 = first === L.line[s] ? gs : heardIn(L.span.get(first)[0], Infinity)[0];
  const g1 = last === L.line[e - 1] ? ge : heardIn(-Infinity, L.span.get(last)[1])[1];
  if (whole) return highBlock(first, last, g0, g1);
  const pieces = kept.flatMap((x) => lines.slice(x, lineAfter(lines, x) + 1).map((line) => line.text));
  const gapless = kept.length === touched.filter((x) => x >= first && x <= last).length;
  return { confidence: 'medium', lines: pieces, la: first, lb: last, g0, g1, whole: gapless };
}

function addEdit(edits, line, edit) {
  if (!edits.has(line)) edits.set(line, []);
  edits.get(line).push(edit);
}

// 제안들이 설명하지 못한 받아쓴 글자 수: 온전한 줄로 된 반복 구절(강함, 줄을 다 덮은 보통, 따로 부른 메아리)에 든 글자만
// 설명된 것으로 본다. 새 구절, 줄 일부만 맞은 조각, 버린 짧은 조각은 설명되지 않은 것이다.
const unexplained = (findings, count) => count - (findings ?? [])
  .filter((f) => f.kind === 'repeat' && f.whole)
  .reduce((sum, f) => sum + f.tj.length, 0);

// 제자리 강함 블록이 가사의 자기 블록 바로 앞에 들어가는지. 오타가 첫 번째 벌에 있으면 가사 블록이 두 번째 벌과 맞아
// 삽입(첫 번째 벌)이 블록 앞에 놓이고, 후렴 두 벌 사이에서 갭이 줄 경계로 갈리면 '끝 줄 | 첫 줄…'로 돌려 부른 조각들이
// 된다(첫 조각이 바로 다음 가사 줄). 반영한 가사는 같아도 블록이 갈리거나 시각이 첫 번째 벌을 가리킨다.
const beforeOwnCopy = (ctx, findings, afterLine) => {
  const { lines, L } = ctx;
  let next = afterLine + 1;
  while (next < lines.length && !L.span.has(next)) next += 1;
  return (findings ?? []).some((f) => f.kind === 'repeat' && f.confidence === 'high' && f.la === next);
};

// 창을 옮기면 가사 [lo, hi)는 풀려난 받아쓴 글자 rel(옮긴 만큼, 원래 갭의 반대쪽 끝)과 짝을 이룬다. 그것이 진짜 회전인지를
// findRepeat와 같은 두 기준으로 본다: 조각 전체로는 양쪽 글자가 서로 repeatSimilarity 이상 짝을 이루고(정확히 맞았거나 자모가
// 비슷한 글자, 짝 없이 사라지는 받아쓴 글자가 없게), [lo, hi)에 걸친 가사 줄마다(구간 밖에 있는 같은 줄의 글자는 원래 정렬대로)
// 덮인 글자가 LINE_COVERAGE 이상이다. 조각 전체의 공통 부분열만 보지 않고 줄마다 보므로, 한 번만 부른 줄을 건너뛰는 창은
// 받지 않는다. 끝말만 같은 애드리브('넌 한 번 한 잔 어때요')로 줄을 채우거나 다음 줄의 첫머리를 흘려 버리는 창은 조각 전체
// 기준에서 걸린다. 회전이면 짝을 못 찾은 풀려난 글자 수, 아니면 −1.
function rotates(ctx, lo, hi, rel) {
  const { L, T, pairs } = ctx;
  const P = L.norm.slice(lo, hi);
  const G = rel.map((j) => T.norm[j]).join('');
  if (!P.length || !G.length) return -1;
  const covered = new Uint8Array(L.norm.length);
  for (const [i, j] of pairs) if (i !== null && j !== null && (i < lo || i >= hi) && covers(T.norm[j], L.norm[i])) covered[i] = 1;
  let used = 0;
  for (const [i, j] of alignChars(P, G)) {
    if (i !== null && j !== null && covers(G[j], P[i])) { covered[lo + i] = 1; used += 1; }
  }
  const enough = THRESHOLDS.repeatSimilarity;
  if (used < enough * G.length || used < enough * P.length) return -1;
  for (let x = L.line[lo]; x <= L.line[hi - 1]; x += 1) {
    if (!L.span.has(x)) continue;
    const [a, b] = L.span.get(x);
    let c = 0;
    for (let p = a; p <= b; p += 1) c += covered[p];
    if (c < LINE_COVERAGE * (b - a + 1)) return -1;
  }
  return G.length - used;
}

// 받아쓰기의 연속된 두 벌 중 어느 쪽을 삽입으로 볼지: 오타 때문에 갭이 후렴 안쪽에서 갈렸으면,
// 갭 길이를 그대로 두고 받아쓰기 창을 옮겨 줄 경계에 맞춘 뒤 반복 구절을 찾는다. 제자리 창의 제안들(앞·뒤를 다시 본 것까지)이
// minGapChars자 이상을 설명하지 못하거나 강함 블록이 가사의 자기 블록 바로 앞에 들어갈 때만 부른다(rest: 제자리에서 설명되지
// 않은 글자 수, pieces: 뒤의 경우 제자리 제안 수, 아니면 0). 옮긴 만큼의 가사 조각이 한 연 안에 있고(두 벌 사이에 한 번만
// 부른 다른 연을 건너뛰지 않게) 풀려난 받아쓰기가 그 줄들을 줄마다 덮는 회전이어야 하며(rotates), 옮긴 창의 반복 구절은
// 강함이고 그 제안들이 제자리보다 덜 남기거나, 뒤의 경우에는 더 남기지도 조각이 더 많지도 않아야 한다(보통을 강함으로
// 올리려고 옮기지 않게). 그런 창이 여럿이면 가장 오른쪽: 받아들인 창은 모두 줄마다 확인한 회전이라 가사에 반영한 결과가 같고,
// 가장 오른쪽 창이 반복을 처음 부른 블록 뒤에(두 번째로 부른 시각으로) 둔다.
function reanchor(ctx, q, tj, rest, pieces) {
  const { L, pairs, at, stanza, lines } = ctx;
  const n = L.norm.length;
  const g = tj.length;
  const j0 = tj[0];
  const j1 = tj.at(-1);
  let best = null;
  for (let b = Math.max(0, q - g); b <= Math.min(n, q + g); b += 1) {
    if (b === q || !(b <= 0 || b >= n || L.line[b - 1] !== L.line[b])) continue;
    let d = 0;
    let rel = null;
    if (b > q) {
      d = neighbor(pairs, at[b - 1], 1, -1) - j1;
      if (d <= 0 || d > g) continue;
      rel = tj.slice(0, d);
    } else {
      d = neighbor(pairs, at[b], 1, 1) - j0;
      if (d >= 0 || -d > g) continue;
      rel = tj.slice(g + d);
    }
    const lo = Math.min(b, q);
    const hi = Math.max(b, q);
    if (stanza[L.line[lo]] !== stanza[L.line[hi - 1]]) continue;
    const lost = rotates(ctx, lo, hi, rel);
    if (lost < 0) continue;
    const moved = tj.map((j) => j + d);
    const match = findRepeat(ctx, moved, b);
    if (match?.confidence !== 'high') continue;
    const findings = gapFindings(ctx, b === 0 ? -1 : lineAfter(lines, L.line[b - 1]), moved, b, match);
    // 회전에서 짝을 못 찾은 풀려난 글자도 설명되지 않은 것이다.
    const left = unexplained(findings, g) + lost;
    const better = left < rest || (left === rest && findings.length <= pieces);
    if (better) best = findings;
  }
  return best;
}

// 받아쓴 글자 tj[k−1]과 tj[k] 사이가 낱말 경계(공백이나 다른 받아쓰기 구간)인지
function wordBreak(T, tj, k) {
  if (k <= 0 || k >= tj.length) return true;
  const a = tj[k - 1];
  const b = tj[k];
  return T.seg[a] !== T.seg[b] || /\s/.test(T.text.slice(T.off[a] + 1, T.off[b]));
}

// 나누는 자리를 가장 가까운 낱말 경계로 옮긴다(heardLines가 낱말 끝까지 넓혀도 글자가 겹치지 않게).
// 거리가 같으면 반복 구절 안쪽으로: 시작(inward +1)은 뒤로, 끝(inward −1)은 앞으로.
function snapBreak(T, tj, k, inward) {
  for (let d = 0; d <= tj.length; d += 1) {
    for (const c of [k + inward * d, k - inward * d]) if (c >= 0 && c <= tj.length && wordBreak(T, tj, c)) return c;
  }
  return k;
}

function gapFinding(ctx, f, afterLine, tj) {
  const { T } = ctx;
  return {
    ...f,
    start: T.s[tj[0]],
    end: T.e[tj.at(-1)],
    op: { type: 'insertLines', afterLine, lines: f.insert },
    hint: heardLines(T, tj).join(' '),
    lines: [afterLine],
    tj,
  };
}

// tj가 받아쓰기 구간을 통째로 덮는지(앞뒤가 모두 구간 경계): 가수가 따로 부른 한 구절이다.
function wholeSegments(T, tj) {
  const a = tj[0];
  const b = tj.at(-1);
  return (a === 0 || T.seg[a - 1] !== T.seg[a]) && (b === T.norm.length - 1 || T.seg[b + 1] !== T.seg[b]);
}

// 삽입 구간을 반복 구절·새 구절로 나눈다. 반복 구절이 구간의 일부만 덮으면 남은 앞·뒤를 다시 본다:
// minGapChars 이상이면 맞는 가사가 있을 때 반복 구절, 없으면 새 구절, 그보다 짧으면 버린다. 받아쓴 글자는 한 제안에만 들어간다.
// 남은 쪽의 반복이 덮은 블록 안의 줄을 다시 부른 메아리이고 그쪽에서 받아쓴 글자 전부이거나(메아리 앞뒤에 다른 노래가
// 붙었으면 그 노래의 일부일 수 있다), 블록 바로 앞·뒤 줄을 온전히(강함) 덮었으면 같은 삽입에 붙인다. 붙는 메아리는 온전한
// 줄이거나, 줄의 일부라도 받아쓰기 구간을 통째로 따로 부른 구절('…꽃피는 내일이 올테니 | 꽃피는 내일이 올테니')이어야 한다.
// 창이나 갭 경계가 줄 중간을 자른 조각(보통)은 붙이면 줄 중간에서 끊긴 블록이 되므로 따로 둔다.
function gapFindings(ctx, afterLine, tj, near, match = findRepeat(ctx, tj, near)) {
  const { T } = ctx;
  if (!match) return [gapFinding(ctx, { kind: 'new', confidence: 'check', insert: heardLines(T, tj) }, afterLine, tj)];
  let g0 = snapBreak(T, tj, match.g0, 1);
  let g1 = snapBreak(T, tj, match.g1, -1);
  if (g1 <= g0) { g0 = match.g0; g1 = match.g1; }
  const lead = g0 >= THRESHOLDS.minGapChars ? gapFindings(ctx, afterLine, tj.slice(0, g0), near) : [];
  const trail = tj.length - g1 >= THRESHOLDS.minGapChars ? gapFindings(ctx, afterLine, tj.slice(g1), near) : [];
  const joins = (f, line, outside, alone) => f?.kind === 'repeat' && f.whole
    && ((alone && line >= match.la && line <= match.lb) || (line === outside && f.confidence === 'high'));
  let insert = match.lines;
  let body = tj.slice(g0, g1);
  const prev = lead.at(-1);
  if (joins(prev, prev?.lb, match.la - 1, prev?.tj.length === g0)) {
    lead.pop();
    insert = [...prev.op.lines, ...insert];
    body = [...prev.tj, ...body];
  }
  const next = trail[0];
  if (joins(next, next?.la, match.lb + 1, next?.tj.length === tj.length - g1)) {
    trail.shift();
    insert = [...insert, ...next.op.lines];
    body = [...body, ...next.tj];
  }
  // 줄의 일부만 맞은 한 줄 메아리도, 맞춘 구간(core)이 낱말 경계로 넓히지 않고도 받아쓰기 구간을 통째로 덮으면(따로 부른
  // 구절이 가사 조각과 그대로 같으면) 온전한 구절로 본다. 끝 글자를 잘못 들은 온전한 줄('바다 멀리 가거나')은 core가 구간
  // 끝에 못 미치므로 조각('바다 멀리 가거')으로 남는다.
  const whole = match.whole || (match.la === match.lb && wholeSegments(T, tj.slice(match.g0, match.g1)));
  const main = gapFinding(ctx, { kind: 'repeat', confidence: match.confidence, insert, la: match.la, lb: match.lb, whole }, afterLine, body);
  return [...lead, main, ...trail];
}

function insertion(ctx, p0, tj, edits) {
  const { L, pairs, lines } = ctx;
  const n = L.norm.length;
  const q = neighbor(pairs, p0, 0, -1) + 1;
  const edge = q <= 0 || q >= n || L.line[q - 1] !== L.line[q];
  const long = tj.length >= THRESHOLDS.minGapChars;
  // 제자리 창: 줄 경계(또는 줄 끝에서 SNAP_CHARS자 안)에 걸친 긴 구간만 삽입으로 본다.
  let afterLine = null;
  if (edge) {
    if (long) afterLine = q === 0 ? -1 : lineAfter(lines, L.line[q - 1]);
  } else if (long) {
    const line = L.line[q];
    const [first, last] = L.span.get(line);
    const head = q - first;
    const tail = last + 1 - q;
    if (Math.min(head, tail) <= SNAP_CHARS) afterLine = tail <= head ? lineAfter(lines, line) : first === 0 ? -1 : lineAfter(lines, L.line[first - 1]);
  }
  const inPlace = afterLine === null ? null : gapFindings(ctx, afterLine, tj, q);
  // 창을 옮겨 보는 것은 제자리 창의 제안들(앞·뒤를 다시 본 것까지)이 minGapChars자 이상을 설명하지 못하거나(갭 경계가 블록
  // 안에서 갈려 두 벌에 걸친 창) 강함 블록이 가사의 자기 블록 바로 앞에 들어갈 때뿐이다. 제자리 제안이 온전한 줄로 구간을
  // 설명하고 블록 뒤에 놓이면(보통이어도) 옮기지 않는다.
  const rest = unexplained(inPlace, tj.length);
  const early = beforeOwnCopy(ctx, inPlace, afterLine);
  const moved = long && (rest >= THRESHOLDS.minGapChars || early) ? reanchor(ctx, q, tj, rest, early ? inPlace.length : 0) : null;
  if (moved) return moved;
  if (afterLine === null) {
    if (!edge) addEdit(edits, L.line[q], { lyr: [], tr: tj, anchor: q - 1 });
    return null;
  }
  return inPlace;
}

function deletion(ctx, p0, p1, li) {
  if (li.length < THRESHOLDS.minGapChars) return null;
  const { L, T, pairs, lines, vocal, total } = ctx;
  const prev = neighbor(pairs, p0, 1, -1);
  const next = neighbor(pairs, p1, 1, 1);
  const start = prev >= 0 ? T.e[prev] : 0;
  const end = next >= 0 ? T.s[next] : total;
  const [k0, k1] = frameRange(start, end, HOP, vocal.length);
  let voiced = 0;
  for (let k = k0; k < k1; k += 1) if (vocal[k]) voiced += 1;
  if (voiced * HOP >= li.length * THRESHOLDS.vocalSecPerChar) return null;
  const count = new Map();
  for (const i of li) count.set(L.line[i], (count.get(L.line[i]) ?? 0) + 1);
  const whole = [...count].filter(([x, c]) => c >= WHOLE_LINE * (L.span.get(x)[1] - L.span.get(x)[0] + 1)).map(([x]) => x);
  let op = null;
  let affected = [...count.keys()];
  if (whole.length) {
    op = { type: 'deleteLines', from: whole[0], to: lineAfter(lines, whole.at(-1)) };
    affected = whole;
  } else if (count.size === 1) {
    const line = lines[L.line[li[0]]];
    const to = collapse(line.text.slice(0, L.off[li[0]]) + line.text.slice(L.off[li.at(-1)] + 1));
    op = { type: 'replaceLine', lines: [line.index], from: line.text, to };
  }
  return {
    kind: 'unheard',
    confidence: 'check',
    start,
    end,
    op,
    hint: lyricPieces(ctx, li[0], li.at(-1)).join(' '),
    lines: affected,
  };
}

// 구간 앞(step −1) 또는 뒤(step +1)에서 가장 가까운, 양쪽 글자가 같은 칸
function exactPair(ctx, p, step) {
  const { L, T, pairs } = ctx;
  for (let k = p; k >= 0 && k < pairs.length; k += step) {
    const [i, j] = pairs[k];
    if (i !== null && j !== null && L.norm[i] === T.norm[j]) return pairs[k];
  }
  return null;
}

// 양쪽이 다른 구간은 줄마다 나눠 고칠 내용으로 모은다. 받아쓴 글자는 짝지은(없으면 앞, 그것도 없으면 뒤) 가사 글자의 줄에 붙인다.
// 다만 구간이 두 줄 경계에 걸치고 두 줄이 서로 다른 받아쓰기 구간으로 불렸으면, 받아쓴 글자는 자기 구간의 줄에 붙인다
// ('…깨우네 | 내 사랑에'를 '…깨내 | 나의 사랑에'로 들었을 때 '나'는 뒷줄이다).
function attachEdits(ctx, p0, p1, edits) {
  const { L, T, pairs } = ctx;
  const before = exactPair(ctx, p0 - 1, -1);
  const after = exactPair(ctx, p1 + 1, 1);
  let split = null;
  if (before && after) {
    const a = L.line[before[0]];
    const b = L.line[after[0]];
    const touched = new Set();
    for (let p = p0; p <= p1; p += 1) if (pairs[p][0] !== null) touched.add(L.line[pairs[p][0]]);
    if (a !== b && T.seg[before[1]] !== T.seg[after[1]] && [...touched].every((x) => x === a || x === b)) {
      split = { a, b, segA: T.seg[before[1]], segB: T.seg[after[1]] };
    }
  }
  let line = L.line[neighbor(pairs, p0, 0, 1)];
  const groups = new Map();
  const group = (x) => {
    if (!groups.has(x)) groups.set(x, { lyr: [], tr: [], anchor: null, before: null });
    return groups.get(x);
  };
  for (let p = p0; p <= p1; p += 1) {
    const [i, j] = pairs[p];
    if (i !== null) {
      line = L.line[i];
      group(line).lyr.push(i);
    }
    if (j === null) continue;
    let target = line;
    if (split && T.seg[j] === split.segB) target = split.b;
    else if (split && T.seg[j] === split.segA) target = split.a;
    group(target).tr.push(j);
  }
  // 가사 글자 없이 받아쓴 글자만 붙은 줄은 앞줄이면 끝에, 뒷줄이면 처음에 넣는다.
  if (split && groups.has(split.a)) groups.get(split.a).anchor = before[0];
  if (split && groups.has(split.b)) groups.get(split.b).before = after[0];
  for (const [x, edit] of groups) addEdit(edits, x, edit);
}

function proposeLine(ctx, line, list) {
  const { L, T } = ctx;
  const at = (e) => (e.lyr.length ? L.off[e.lyr[0]] : e.anchor !== null && e.anchor !== undefined ? L.off[e.anchor] + 1 : L.off[e.before]);
  const to = (e) => (e.lyr.length ? L.off[e.lyr.at(-1)] + 1 : at(e));
  let text = line.text;
  // 오른쪽부터 고친다. 같은 위치면 범위 바꿈을 먼저 하고 그 앞에 삽입을 넣는다.
  for (const e of [...list].sort((x, y) => at(y) - at(x) || to(y) - to(x))) {
    const a = at(e);
    const b = to(e);
    let mid = '';
    if (e.tr.length) {
      const c = T.off[e.tr[0]];
      const d = T.off[e.tr.at(-1)] + 1;
      mid = T.text.slice(c, d);
      if (c > 0 && /\s/.test(T.text[c - 1])) mid = ` ${mid}`;
      if (d < T.text.length && /\s/.test(T.text[d])) mid = `${mid} `;
    }
    text = text.slice(0, a) + mid + text.slice(b);
  }
  return collapse(text);
}

function suggestion(trackId, f) {
  const start = round(f.start);
  const end = round(f.end);
  const hash = createHash('sha256').update(JSON.stringify([f.kind, f.op, start, end])).digest('hex').slice(0, 8);
  return {
    id: `${trackId}:${f.kind}:${f.lines.join(',')}:${hash}`,
    trackId,
    kind: f.kind,
    confidence: f.confidence,
    start,
    end,
    op: f.op,
    hint: f.hint,
    score: null,
    lines: f.lines,
  };
}

// ── 표기·발음만 다른 차이 ──
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const MINOR_JAMO = 2;
const MINOR_SYLLABLES = 1;
const REMAP_MARGIN = 0.1;

// 한글 음절을 호환 자모(초성·중성·종성 각 한 글자)로 푼다. 다른 글자는 그대로 둔다.
function jamo(text) {
  const out = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out.push(ch); continue; }
    out.push(CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)]);
    if (c % 28) out.push(JONG[c % 28]);
  }
  return out;
}

function editDistance(x, y) {
  let prev = Array.from({ length: y.length + 1 }, (_, k) => k);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

// 정규화한 두 줄을 같은 글자 구간과 차이 구간으로 나눈다. 같은 글자 mergeGap개 이하로 떨어진 차이 구간은
// 하나로 합친다(사이 글자 포함). 차이 구간마다 a 쪽 글자, b 쪽 글자, 작은 차이인지(minor).
function diffParts(a, b) {
  const runs = [];
  for (const [i, j] of alignChars(a, b)) {
    const same = i !== null && j !== null && a[i] === b[j];
    let last = runs.at(-1);
    if (!last || last.same !== same) {
      last = { a: '', b: '', same };
      runs.push(last);
    }
    if (i !== null) last.a += a[i];
    if (j !== null) last.b += b[j];
  }
  const parts = [];
  for (const run of runs) {
    const [diff, between] = parts.slice(-2);
    if (!run.same && between?.same && between.a.length <= THRESHOLDS.mergeGap && diff && !diff.same) {
      parts.pop();
      diff.a += between.a + run.a;
      diff.b += between.b + run.b;
    } else {
      parts.push(run);
    }
  }
  for (const p of parts) {
    if (!p.same) p.minor = Math.abs(p.a.length - p.b.length) <= MINOR_SYLLABLES && editDistance(jamo(p.a), jamo(p.b)) <= MINOR_JAMO;
  }
  return parts;
}

// 모든 차이 구간이 작은 차이(자모 편집 거리 ≤ 2, 글자 수 차이 ≤ 1)면 표기·발음만 다른 것으로 본다.
function minorVariant(a, b) {
  const diffs = diffParts(a, b).filter((p) => !p.same);
  return diffs.length > 0 && diffs.every((p) => p.minor);
}

// 제안 줄의 작은 차이 구간(표기·발음, minorVariant와 같은 기준)을 가사 표기로 되돌린다(판정 R27): 다시 받아쓰기가 그런 구간을
// 가려 주지 못하므로 확인되지 않은 표기가 제안에 남지 않게 한다. 구간 앞뒤의 같은 글자 사이 원문을 통째로 바꿔 띄어쓰기도
// 가사를 따른다('올꺼야' → '올 거야').
function lyricSpelling(lyricText, toText) {
  const A = normalizeText(lyricText);
  const B = normalizeText(toText);
  let out = '';
  let cut = 0;
  let ia = 0;
  let ib = 0;
  for (const p of diffParts(A.norm, B.norm)) {
    if (!p.same && p.minor) {
      const toFrom = ib > 0 ? B.map[ib - 1] + 1 : 0;
      const toEnd = ib + p.b.length < B.norm.length ? B.map[ib + p.b.length] : toText.length;
      const lyFrom = ia > 0 ? A.map[ia - 1] + 1 : 0;
      const lyEnd = ia + p.a.length < A.norm.length ? A.map[ia + p.a.length] : lyricText.length;
      out += toText.slice(cut, toFrom) + lyricText.slice(lyFrom, lyEnd);
      cut = toEnd;
    }
    ia += p.a.length;
    ib += p.b.length;
  }
  return collapse(out + toText.slice(cut));
}

// 다르게 불린 줄: (원래 줄, 제안 줄)이 같으면 한 제안으로 묶고, 줄마다 점수 요청을 만든다.
// 표기·발음만 다른 줄은 내지 않고, 다른 줄도 표기·발음만 다른 구간은 가사 표기로 쓴다(lyricSpelling, 묶기와 점수 모두 그 줄로).
// 받아쓴 줄이 다른 가사 줄에 자기 줄보다 REMAP_MARGIN 넘게 가깝고 remapSimilarity 이상이면 그 줄의 표기로 바꾼다(remap).
function replaceSuggestions(ctx, edits, out, requests) {
  const { L, T, pairs, lines, sung, total, trackId } = ctx;
  const times = new Map();
  for (const [i, j] of pairs) {
    if (i === null || j === null) continue;
    const [s, e] = times.get(L.line[i]) ?? [Infinity, -Infinity];
    times.set(L.line[i], [Math.min(s, T.s[j]), Math.max(e, T.e[j])]);
  }
  const groups = new Map();
  for (const [index, list] of [...edits].sort((x, y) => x[0] - y[0])) {
    const line = lines[index];
    const heard = proposeLine(ctx, line, list);
    let to = heard;
    let toNorm = normalizeText(heard).norm;
    if (!toNorm || toNorm === line.norm) continue; // 줄을 비우는 바꿈은 내지 않는다(짧은 가사만 차이는 무시)
    let best = null;
    let bestSim = 0;
    for (const other of sung) {
      if (other.norm === line.norm) continue;
      const sim = similarity(toNorm, other.norm);
      if (sim > bestSim) { bestSim = sim; best = other; }
    }
    let remap = false;
    if (best && bestSim >= THRESHOLDS.remapSimilarity && bestSim >= similarity(toNorm, line.norm) + REMAP_MARGIN) {
      to = best.text.trim();
      toNorm = best.norm;
      remap = true;
    }
    if (minorVariant(line.norm, toNorm)) continue;
    if (!remap) {
      to = lyricSpelling(line.text, to);
      toNorm = normalizeText(to).norm;
    }
    let [start, end] = times.get(index) ?? [Infinity, -Infinity];
    for (const e of list) {
      for (const j of e.tr) { start = Math.min(start, T.s[j]); end = Math.max(end, T.e[j]); }
    }
    if (!Number.isFinite(start)) continue;
    const key = `${line.norm}\n${toNorm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, from: line.text, to, start, end, heard, remap });
  }
  for (const occ of groups.values()) {
    const [first] = occ;
    const grouped = occ.map((o) => o.index);
    const op = { type: 'replaceLine', lines: grouped, from: first.from, to: first.to };
    const s = suggestion(trackId, {
      kind: 'replace', confidence: 'check', start: first.start, end: first.end, op, hint: first.heard, lines: grouped,
    });
    out.push(s);
    occ.forEach((o, k) => {
      const ws = Math.max(0, o.start - SCORE_PAD_SEC);
      const we = Math.min(total, o.end + SCORE_PAD_SEC, ws + SCORE_MAX_SEC);
      requests.push({ id: `${s.id}:${k}`, suggestionId: s.id, start: round(ws), end: round(we), candidates: [o.from, o.to], remap: o.remap });
    });
  }
}

// 받아쓰기 구간과 겹치지 않는 보컬이 unclearSec 이상 이어지면 알린다. 직전 구간 끝 holdSec 안에서 시작하면 끄는 음으로 본다.
function unclearSuggestions(ctx, segments, out) {
  const { vocal, trackId } = ctx;
  const covered = new Array(vocal.length).fill(false);
  for (const seg of segments) {
    const [k0, k1] = frameRange(seg.s, seg.e, HOP, vocal.length);
    for (let k = k0; k < k1; k += 1) covered[k] = true;
  }
  let k = 0;
  while (k < vocal.length) {
    if (!vocal[k] || covered[k]) { k += 1; continue; }
    let k2 = k;
    while (k2 < vocal.length && vocal[k2] && !covered[k2]) k2 += 1;
    const start = k * HOP;
    const end = k2 * HOP;
    const prevEnd = Math.max(-Infinity, ...segments.filter((seg) => seg.e <= start).map((seg) => seg.e));
    if (end - start >= THRESHOLDS.unclearSec && start - prevEnd > THRESHOLDS.holdSec) {
      out.push(suggestion(trackId, { kind: 'unclear', confidence: 'check', start, end, op: null, hint: '', lines: [] }));
    }
    k = k2;
  }
}

// 믹스 기준 보컬 dB(level)에서 보컬 프레임 비율. level이 없으면(예전 분석) 알 수 없음(null).
export function vocalPresence(level) {
  if (!Array.isArray(level) || !level.length) return null;
  return level.filter((v) => v >= THRESHOLDS.vocalDb).length / level.length;
}

// 보컬이 있는지(보컬 없음·연주곡의 보컬 경고)는 믹스 기준 level로 판단한다. 스템 자신 기준인 energy는 늘 10% 이상이 0dB
// 이상이라 보컬이 없어도 비율이 낮아지지 않는다. level이 없으면 그런 경고를 내지 않는다.
export function draftSuggestions({ trackId, lyrics, segments, energy, level, duration, instrumental }) {
  const segs = Array.isArray(segments) ? segments : [];
  const en = Array.isArray(energy) ? energy : [];
  const T = transcriptChars(segs);
  const total = Number.isFinite(duration) && duration > 0 ? duration : Math.max(en.length * HOP, T.e.at(-1) ?? 0);
  const lines = lyricLines(lyrics);
  const sung = lines.filter((line) => !line.translation && line.norm);
  const vocal = en.map((v) => v >= THRESHOLDS.vocalDb);
  const presence = vocalPresence(level);
  const out = [];
  const scoreRequests = [];
  if (instrumental) {
    if (presence !== null && presence > THRESHOLDS.mrVocalRatio) {
      const heard = level.map((v) => v >= THRESHOLDS.vocalDb);
      out.push(suggestion(trackId, {
        kind: 'instrumental', confidence: 'check', start: heard.indexOf(true) * HOP,
        end: (heard.lastIndexOf(true) + 1) * HOP, op: null, hint: T.text, lines: [],
      }));
    }
    return { suggestions: out, scoreRequests };
  }
  if (sung.length && presence !== null && presence < THRESHOLDS.noVocalRatio) {
    out.push(suggestion(trackId, { kind: 'no-vocal', confidence: 'check', start: 0, end: total, op: null, hint: '', lines: [] }));
    return { suggestions: out, scoreRequests };
  }
  const L = lyricChars(lines);
  const pairs = alignChars(L.norm, T.norm);
  slideGaps(pairs, L, T);
  const at = new Int32Array(L.norm.length);
  pairs.forEach(([i], p) => { if (i !== null) at[i] = p; });
  // 줄마다 연(빈 줄로 나뉜 블록) 번호
  const stanza = new Int32Array(lines.length);
  lines.reduce((block, line, x) => { stanza[x] = line.text.trim() === '' ? block + 1 : block; return stanza[x]; }, 0);
  const ctx = { trackId, lines, sung, L, T, pairs, at, vocal, total, stanza };
  const edits = new Map();
  for (const { p0, p1 } of diffRegions(pairs, L.norm, T.norm)) {
    const li = [];
    const tj = [];
    for (let p = p0; p <= p1; p += 1) {
      if (pairs[p][0] !== null) li.push(pairs[p][0]);
      if (pairs[p][1] !== null) tj.push(pairs[p][1]);
    }
    let found = null;
    if (!li.length) found = insertion(ctx, p0, tj, edits);
    else if (!tj.length) found = [deletion(ctx, p0, p1, li)];
    else attachEdits(ctx, p0, p1, edits);
    for (const f of found ?? []) if (f) out.push(suggestion(trackId, f));
  }
  replaceSuggestions(ctx, edits, out, scoreRequests);
  unclearSuggestions(ctx, segs, out);
  out.sort((a, b) => a.start - b.start);
  return { suggestions: out, scoreRequests };
}

// 가사 줄을 프롬프트로 다시 받아쓴 글이 제안 줄을 얼마나 더 지지하는지(−1…1). 0 이하면 가사 쪽이다.
// 제안 줄의 작은 차이 구간(표기·발음, minorVariant와 같은 기준)은 가사 표기로 되돌려 비교한다:
// 프롬프트가 그런 구간을 쉽게 가사 쪽으로 돌려 놓으므로 증거가 되지 않는다.
function redecodeSupport(text, [lyric, proposed]) {
  const heard = normalizeText(text).norm;
  const from = normalizeText(lyric).norm;
  const core = diffParts(from, normalizeText(proposed).norm).map((p) => (p.minor ? p.a : p.b)).join('');
  return similarity(heard, core) - similarity(heard, from);
}

const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

// 바꿈 제안만 판정한다. Δ = 제안 점수 − 가사 점수(묶인 줄은 평균). 점수가 없으면 확인 필요로 남긴다.
// 강제 점수는 Whisper가 자기 받아쓰기를 편드므로, 다시 받아쓴 글(redecodes[요청 id])이 있으면
// 지지도(묶인 줄은 평균)가 0 이하인 제안은 버리고, 강함은 다른 가사 줄로 바꾼 제안이거나 두 번 이상 지지받은 것만 준다.
// redecodes에 요청 id가 없으면(다시 받아쓰기를 하지 않은 호출) Δ만으로 판정하고, 문자열이 아닌 값(null: 하려다 실패)이면
// 확인되지 않은 것으로 보아 지지도 없이 보통까지만 준다.
export function finalizeSuggestions(draft, scores, redecodes = {}) {
  const byId = new Map();
  for (const req of draft?.scoreRequests ?? []) {
    const v = scores?.[req.id];
    if (!Array.isArray(v) || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
    const tried = redecodes != null && Object.hasOwn(redecodes, req.id);
    const text = tried ? redecodes[req.id] : undefined;
    // 숫자: 지지도, null: 확인 안 됨, undefined: 다시 받아쓰기를 하지 않음
    const support = typeof text === 'string' ? redecodeSupport(text, req.candidates) : tried ? null : undefined;
    if (!byId.has(req.suggestionId)) byId.set(req.suggestionId, []);
    byId.get(req.suggestionId).push({ delta: v[1] - v[0], support, remap: req.remap === true });
  }
  const out = [];
  for (const s of draft?.suggestions ?? []) {
    if (s.kind !== 'replace') { out.push(s); continue; }
    const members = byId.get(s.id);
    if (!members?.length) { out.push({ ...s, confidence: 'check', score: null }); continue; }
    const delta = mean(members.map((m) => m.delta));
    const checked = members.filter((m) => typeof m.support === 'number');
    let strong = members.every((m) => m.support === undefined);
    if (checked.length) {
      if (mean(checked.map((m) => m.support)) <= 0) continue;
      strong = members.some((m) => m.remap) || checked.filter((m) => m.support > 0).length >= 2;
    }
    if (delta < THRESHOLDS.mediumDelta) continue;
    out.push({ ...s, confidence: delta >= THRESHOLDS.strongDelta && strong ? 'high' : 'medium', score: round(delta) });
  }
  return out;
}

const OVERLAP_ERROR = '같은 줄을 고치는 제안이 겹칩니다. 제안을 하나만 선택하세요.';

const EMPTY_TEXT_ERROR = '새 구절 내용이 비어 있습니다. 내용을 쓰거나 선택을 해제하세요.';

// 관리자가 고친 새 구절. 앞뒤 빈 줄은 버리고, 남는 내용이 없으면(지운 칸) 빈 줄을 넣지 않고 거절한다.
function editedLines(text) {
  const lines = String(text).split('\n').map((l) => l.replace(/\r$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (!lines.length) throw new Error(EMPTY_TEXT_ERROR);
  return lines;
}

// 선택한 제안을 가사에 반영한다. 줄 번호는 제안을 만든 가사의 split('\n') 기준이다.
export function applySuggestions(lyrics, suggestions, items) {
  const text = String(lyrics ?? '');
  const lines = text === '' ? [] : text.split('\n');
  const byId = new Map((suggestions ?? []).map((s) => [s.id, s]));
  const edits = [];
  const touched = new Set();
  const touch = (i) => {
    if (touched.has(i)) throw new Error(OVERLAP_ERROR);
    touched.add(i);
  };
  (items ?? []).forEach((item, order) => {
    const s = byId.get(item?.suggestionId);
    if (!s || !s.op) throw new Error('반영할 수 없는 제안이 있습니다.');
    const op = s.op;
    if (op.type === 'insertLines') {
      const at = op.afterLine + 1;
      if (!Number.isInteger(at) || at < 0 || at > lines.length) throw new Error(OVERLAP_ERROR);
      const hasText = s.kind === 'new' && typeof item.text === 'string';
      edits.push({ start: at, end: at, lines: hasText ? editedLines(item.text) : op.lines, order });
    } else if (op.type === 'replaceLine') {
      const want = normalizeText(op.from).norm;
      for (const i of op.lines) {
        if (!Number.isInteger(i) || i < 0 || i >= lines.length || normalizeText(lines[i]).norm !== want) {
          throw new Error(OVERLAP_ERROR);
        }
        touch(i);
      }
      for (const i of op.lines) edits.push({ start: i, end: i + 1, lines: [op.to], order });
    } else if (op.type === 'deleteLines') {
      if (!Number.isInteger(op.from) || !Number.isInteger(op.to) || op.from < 0 || op.to < op.from || op.to >= lines.length) {
        throw new Error(OVERLAP_ERROR);
      }
      for (let i = op.from; i <= op.to; i += 1) touch(i);
      edits.push({ start: op.from, end: op.to + 1, lines: [], order });
    } else {
      throw new Error('반영할 수 없는 제안이 있습니다.');
    }
  });
  const deletes = edits.filter((e) => e.lines.length === 0 && e.end > e.start);
  for (const e of edits) {
    if (e.start === e.end && deletes.some((d) => d.start < e.start && e.start < d.end)) throw new Error(OVERLAP_ERROR);
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end || b.order - a.order);
  for (const e of edits) lines.splice(e.start, e.end - e.start, ...e.lines);
  return lines.join('\n');
}
