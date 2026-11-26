import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THRESHOLDS,
  AUDIO_EXTENSIONS,
  lyricsHash,
  normalizeText,
  lyricLines,
  foreignRatio,
  similarity,
  alignChars,
  autoMapping,
  validateMapping,
} from '../audio-check.mjs';

test('normalizeText keeps hangul/latin/digits and maps back to source offsets', () => {
  const { norm, map } = normalizeText('바람 따라, Go 2!');
  assert.equal(norm, '바람따라go2');
  // 'g' sits at source offset 7 (the brief's 6 points at the space before it)
  assert.equal(map[4], 7);
  assert.equal(map.length, norm.length);
});

test('lyricLines flags desk translation lines', () => {
  const lines = lyricLines('Hello\n(번역: 안녕)\n');
  assert.equal(lines[1].translation, true);
  assert.equal(lines[0].translation, false);
  assert.equal(lines[2].text, '');
  assert.equal(lines[1].index, 1);
});

test('foreignRatio counts latin letters among letters', () => {
  assert.equal(foreignRatio('가나다라'), 0);
  assert.ok(Math.abs(foreignRatio('abcd\n가나다라') - 0.5) < 1e-9);
  assert.equal(foreignRatio('hello\n(번역: 안녕하세요)'), 1);
});

test('alignChars aligns a repeated block as one gap', () => {
  const a = '가나다라마바사'.repeat(2);
  const b = '가나다라마바사'.repeat(3);
  const pairs = alignChars(a, b);
  const gapIdx = pairs.map((p, k) => (p[0] === null ? k : -1)).filter((k) => k >= 0);
  assert.equal(gapIdx.length, 7);
  assert.equal(gapIdx[6] - gapIdx[0], 6);
  assert.equal(pairs.filter((p) => p[0] !== null && p[1] !== null).length, 14);
});

test('alignChars scores same initial+vowel as partial match', () => {
  const pairs = alignChars('가', '각');
  assert.deepEqual(pairs, [[0, 0]]);
});

test('similarity', () => {
  assert.ok(Math.abs(similarity('사랑찾는밤나비', '외로운사랑찾는밤나비') - 0.82) < 0.01);
  assert.equal(similarity('abc', 'xyz'), 0);
  assert.equal(similarity('', ''), 1);
});

test('lyricsHash is sha256 hex', () => {
  assert.match(lyricsHash('a'), /^[0-9a-f]{64}$/);
  assert.notEqual(lyricsHash('a'), lyricsHash('b'));
});

test('constants', () => {
  assert.equal(THRESHOLDS.strongDelta, 8);
  assert.equal(THRESHOLDS.mrResidualDb, -12);
  assert.ok(AUDIO_EXTENSIONS.has('wav') && !AUDIO_EXTENSIONS.has('pdf'));
});

const tracks = [
  { id: 't1', track_no: 1, track_title: '첫 노래' },
  { id: 't7', track_no: 7, track_title: '일곱' },
  { id: 't10', track_no: 10, track_title: '첫 노래 (MR)', is_instrumental: true },
];
const att = (id, name) => ({ id, name, storedName: id, bytes: 1, createdAt: '', sha256: id });
const attachments = [
  att('a1', '01_첫 노래.wav'),
  att('a2', '07 일곱.mp3'),
  att('a3', '07 일곱.wav'),
  att('a4', '첫 노래 (MR).wav'),
  att('a5', 'notes.pdf'),
];

test('autoMapping prefers leading numbers, then titles, then lossless duplicates, and pairs MR', () => {
  const r = autoMapping(tracks, attachments);
  assert.equal(r.mapping.t1, 'a1');
  assert.equal(r.mapping.t7, 'a3');
  assert.ok(r.duplicates.some((d) => d.attachmentId === 'a2' && d.trackId === 't7'));
  assert.equal(r.mapping.t10, 'a4');
  assert.equal(r.mrPairs.t10, 't1');
  assert.ok(!r.unmapped.includes('a5'));
  assert.deepEqual(r.unmapped, []);
});

test('autoMapping lists unmatched audio and nulls empty tracks', () => {
  const r = autoMapping([{ id: 't1', track_no: 1, track_title: '가' }], [att('x', 'zzz.wav')]);
  assert.equal(r.mapping.t1, null);
  assert.deepEqual(r.unmapped, ['x']);
});

test('validateMapping rejects bad input', () => {
  assert.doesNotThrow(() => validateMapping({ t1: 'a1', t7: null }, tracks, attachments));
  assert.throws(() => validateMapping({ t1: 'a1', t7: 'a1' }, tracks, attachments), /같은 음원/);
  assert.throws(() => validateMapping({ nope: 'a1' }, tracks, attachments), /트랙/);
  assert.throws(() => validateMapping({ t1: 'zz' }, tracks, attachments), /음원/);
  assert.throws(() => validateMapping({ t1: 'a5' }, tracks, attachments), /오디오/);
});
