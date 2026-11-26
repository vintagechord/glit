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
// segments: [{ s, e, t, words: [{ s, e, w }] }], energy[k]: 프레임 [k·hop, (k+1)·hop)의 보컬 dB(곡 90퍼센타일 기준)

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

// G를 가사 안의 가장 비슷한 부분 문자열에 맞춘다(G 전체, 가사 양끝 자유). 같은 점수면 near 바로 앞을 고른다.
function locate(G, P, near) {
  const g = G.length;
  const n = P.length;
  if (!g || !n) return null;
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
  let lo = -1;
  let hi = -1;
  while (i > 0) {
    const k = i * w + j;
    const same = j > 0 && G[i - 1] === P[j - 1];
    if (j > 0 && D[k] === D[k - w - 1] + (same ? 1 : -1)) {
      if (same) { lo = j - 1; if (hi < 0) hi = j - 1; }
      i -= 1;
      j -= 1;
    } else if (j > 0 && D[k] === D[k - 1] - 1) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return hi < 0 ? null : { start: lo, end: hi + 1 };
}

function findRepeat(ctx, G, near) {
  const { L, lines } = ctx;
  const span = locate(G, L.norm, near);
  if (!span || similarity(G, L.norm.slice(span.start, span.end)) < THRESHOLDS.repeatSimilarity) return null;
  const la = L.line[span.start];
  const lb = L.line[span.end - 1];
  const b0 = L.span.get(la)[0];
  const b1 = L.span.get(lb)[1] + 1;
  const whole = span.end - span.start >= WHOLE_LINE * (b1 - b0)
    && similarity(G, L.norm.slice(b0, b1)) >= THRESHOLDS.repeatSimilarity;
  if (!whole) return { confidence: 'medium', lines: lyricPieces(ctx, span.start, span.end - 1) };
  const block = lines.slice(la, lineAfter(lines, lb) + 1).map((line) => line.text);
  if (la > 0 && lines[la - 1].text.trim() === '') block.unshift('');
  return { confidence: 'high', lines: block };
}

function addEdit(edits, line, edit) {
  if (!edits.has(line)) edits.set(line, []);
  edits.get(line).push(edit);
}

// 받아쓰기의 연속된 두 벌 중 어느 쪽을 삽입으로 볼지: 오타 때문에 갭이 후렴 안쪽에서 갈렸으면,
// 갭 길이를 그대로 두고 받아쓰기 창을 옮겨 줄 경계에 맞춘 뒤 반복 구절을 찾는다.
// 옮긴 만큼의 가사 조각이 반대편 받아쓰기 조각과 repeatSimilarity 이상 같아야 한다. 확신 높은 것, 그다음 가장 오른쪽.
function reanchor(ctx, q, tj) {
  const { L, T, pairs, at } = ctx;
  const n = L.norm.length;
  const g = tj.length;
  const j0 = tj[0];
  const j1 = tj.at(-1);
  let best = null;
  for (let b = Math.max(0, q - g); b <= Math.min(n, q + g); b += 1) {
    if (!(b <= 0 || b >= n || L.line[b - 1] !== L.line[b])) continue;
    let d = 0;
    if (b > q) {
      d = neighbor(pairs, at[b - 1], 1, -1) - j1;
      if (d <= 0 || d > g || similarity(L.norm.slice(q, b), T.norm.slice(j0, j0 + d)) < THRESHOLDS.repeatSimilarity) continue;
    } else if (b < q) {
      d = neighbor(pairs, at[b], 1, 1) - j0;
      if (d >= 0 || -d > g || similarity(L.norm.slice(b, q), T.norm.slice(j1 + d + 1, j1 + 1)) < THRESHOLDS.repeatSimilarity) continue;
    }
    const match = findRepeat(ctx, T.norm.slice(j0 + d, j1 + d + 1), b);
    const rank = match?.confidence === 'high' ? 2 : 1;
    if (match && (!best || rank >= best.rank)) best = { rank, match, b, tj: tj.map((j) => j + d) };
  }
  return best;
}

function insertion(ctx, p0, tj, edits) {
  const { L, T, pairs, lines } = ctx;
  const n = L.norm.length;
  const q = neighbor(pairs, p0, 0, -1) + 1;
  const edge = q <= 0 || q >= n || L.line[q - 1] !== L.line[q];
  const long = tj.length >= THRESHOLDS.minGapChars;
  const moved = long ? reanchor(ctx, q, tj) : null;
  if (moved) {
    const afterLine = moved.b === 0 ? -1 : lineAfter(lines, L.line[moved.b - 1]);
    return {
      kind: 'repeat',
      confidence: moved.match.confidence,
      start: T.s[moved.tj[0]],
      end: T.e[moved.tj.at(-1)],
      op: { type: 'insertLines', afterLine, lines: moved.match.lines },
      hint: heardLines(T, moved.tj).join(' '),
      lines: [afterLine],
    };
  }
  let afterLine;
  if (edge) {
    if (!long) return null;
    afterLine = q === 0 ? -1 : lineAfter(lines, L.line[q - 1]);
  } else {
    const line = L.line[q];
    const [first, last] = L.span.get(line);
    const head = q - first;
    const tail = last + 1 - q;
    if (!long || Math.min(head, tail) > SNAP_CHARS) {
      addEdit(edits, line, { lyr: [], tr: tj, anchor: q - 1 });
      return null;
    }
    afterLine = tail <= head ? lineAfter(lines, line) : first === 0 ? -1 : lineAfter(lines, L.line[first - 1]);
  }
  const G = tj.map((j) => T.norm[j]).join('');
  const heard = heardLines(T, tj);
  const match = findRepeat(ctx, G, q);
  return {
    kind: match ? 'repeat' : 'new',
    confidence: match ? match.confidence : 'check',
    start: T.s[tj[0]],
    end: T.e[tj.at(-1)],
    op: { type: 'insertLines', afterLine, lines: match ? match.lines : heard },
    hint: heard.join(' '),
    lines: [afterLine],
  };
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

// 다르게 불린 줄: (원래 줄, 제안 줄)이 같으면 한 제안으로 묶고, 줄마다 점수 요청을 만든다.
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
    if (best && bestSim >= THRESHOLDS.repeatSimilarity && bestSim > similarity(toNorm, line.norm)) {
      to = best.text.trim();
      toNorm = best.norm;
    }
    let [start, end] = times.get(index) ?? [Infinity, -Infinity];
    for (const e of list) {
      for (const j of e.tr) { start = Math.min(start, T.s[j]); end = Math.max(end, T.e[j]); }
    }
    if (!Number.isFinite(start)) continue;
    const key = `${line.norm}\n${toNorm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, from: line.text, to, start, end, heard });
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
      requests.push({ id: `${s.id}:${k}`, suggestionId: s.id, start: round(ws), end: round(we), candidates: [o.from, o.to] });
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

export function draftSuggestions({ trackId, lyrics, segments, energy, duration, instrumental }) {
  const segs = Array.isArray(segments) ? segments : [];
  const en = Array.isArray(energy) ? energy : [];
  const T = transcriptChars(segs);
  const total = Number.isFinite(duration) && duration > 0 ? duration : Math.max(en.length * HOP, T.e.at(-1) ?? 0);
  const lines = lyricLines(lyrics);
  const sung = lines.filter((line) => !line.translation && line.norm);
  const vocal = en.map((v) => v >= THRESHOLDS.vocalDb);
  const ratio = en.length ? vocal.filter(Boolean).length / en.length : null;
  const out = [];
  const scoreRequests = [];
  if (instrumental) {
    if (ratio !== null && ratio > THRESHOLDS.mrVocalRatio) {
      out.push(suggestion(trackId, {
        kind: 'instrumental', confidence: 'check', start: vocal.indexOf(true) * HOP,
        end: (vocal.lastIndexOf(true) + 1) * HOP, op: null, hint: T.text, lines: [],
      }));
    }
    return { suggestions: out, scoreRequests };
  }
  if (sung.length && ratio !== null && ratio < THRESHOLDS.noVocalRatio) {
    out.push(suggestion(trackId, { kind: 'no-vocal', confidence: 'check', start: 0, end: total, op: null, hint: '', lines: [] }));
    return { suggestions: out, scoreRequests };
  }
  const L = lyricChars(lines);
  const pairs = alignChars(L.norm, T.norm);
  slideGaps(pairs, L, T);
  const at = new Int32Array(L.norm.length);
  pairs.forEach(([i], p) => { if (i !== null) at[i] = p; });
  const ctx = { trackId, lines, sung, L, T, pairs, at, vocal, total };
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
    else if (!tj.length) found = deletion(ctx, p0, p1, li);
    else attachEdits(ctx, p0, p1, edits);
    if (found) out.push(suggestion(trackId, found));
  }
  replaceSuggestions(ctx, edits, out, scoreRequests);
  unclearSuggestions(ctx, segs, out);
  out.sort((a, b) => a.start - b.start);
  return { suggestions: out, scoreRequests };
}

// 바꿈 제안만 점수로 판정한다. Δ = 제안 점수 − 가사 점수(묶인 줄은 평균). 점수가 없으면 확인 필요로 남긴다.
export function finalizeSuggestions(draft, scores) {
  const byId = new Map();
  for (const req of draft?.scoreRequests ?? []) {
    const v = scores?.[req.id];
    if (!Array.isArray(v) || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
    if (!byId.has(req.suggestionId)) byId.set(req.suggestionId, []);
    byId.get(req.suggestionId).push(v[1] - v[0]);
  }
  const out = [];
  for (const s of draft?.suggestions ?? []) {
    if (s.kind !== 'replace') { out.push(s); continue; }
    const deltas = byId.get(s.id);
    if (!deltas?.length) { out.push({ ...s, confidence: 'check', score: null }); continue; }
    const delta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    if (delta < THRESHOLDS.mediumDelta) continue;
    out.push({ ...s, confidence: delta >= THRESHOLDS.strongDelta ? 'high' : 'medium', score: round(delta) });
  }
  return out;
}

const OVERLAP_ERROR = '같은 줄을 고치는 제안이 겹칩니다. 제안을 하나만 선택하세요.';

function editedLines(text) {
  const lines = String(text).split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
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
