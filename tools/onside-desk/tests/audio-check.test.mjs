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
  cleanTranscript,
  draftSuggestions,
  finalizeSuggestions,
  applySuggestions,
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
  assert.equal(THRESHOLDS.repeatSimilarity, 0.75);
  assert.equal(THRESHOLDS.remapSimilarity, 0.55);
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

test('autoMapping matches NFD (macOS) filenames by title', () => {
  const r = autoMapping(
    [{ id: 't1', track_no: 1, track_title: '첫 노래'.normalize('NFD') }],
    [att('a', '첫 노래.wav'.normalize('NFD'))],
  );
  assert.equal(r.mapping.t1, 'a');
  assert.deepEqual(r.unmapped, []);
});

// ── 받아쓰기 정리와 제안 ── 가사는 지어낸 문장이다. 낱말 시각은 글자 수에 비례해 직접 나눈다.
function seg(t, s, e) {
  const parts = t.split(' ');
  const chars = parts.reduce((n, w) => n + w.length, 0);
  let at = s;
  const words = parts.map((w) => {
    const d = ((e - s) * w.length) / chars;
    const word = { s: at, e: at + d, w: ` ${w}` };
    at += d;
    return word;
  });
  return { s, e, t, words };
}
const frames = (sec, level) =>
  Array.from({ length: Math.round(sec / 0.25) }, (_, k) => (typeof level === 'function' ? level(k * 0.25) : level));
const draft = (lyrics, segments, energy, extra = {}) =>
  draftSuggestions({ trackId: 't1', lyrics, segments, energy, duration: energy.length * 0.25, instrumental: false, ...extra });
const CHORUS = '하늘 높이 날아라\n\n바다 멀리 가거라\n함께 노래하자';
const chorusSegs = () => [seg('하늘 높이 날아라', 0, 3), seg('바다 멀리 가거라', 4, 7), seg('함께 노래하자', 7, 10)];
const near = (a, b) => Math.abs(a - b) < 0.01;

test('cleanTranscript drops hallucinations, quiet and looping segments', () => {
  const energy = frames(16, (t) => (t >= 5 && t < 7 ? -40 : -5));
  const first = seg('하늘 높이 날아라', 0, 2);
  const sixTimes = seg('라 라 라 라 라 라', 10, 12);
  const last = seg('함께 노래하자', 12, 14);
  const segments = [
    first,
    seg('시청해주셔서 감사합니다', 2, 4),
    seg('바다', 4, 4.2),
    seg('바다 멀리 가거라', 5, 7),
    seg('라 라 라 라 라 라 라', 8, 10),
    sixTimes,
    last,
  ];
  assert.deepEqual(cleanTranscript(segments, energy), [first, sixTimes, last]);
});

test('missing repeated chorus becomes a high-confidence repeat insert', () => {
  const segments = [...chorusSegs(), seg('바다 멀리 가거라', 11, 14), seg('함께 노래하자', 14, 17)];
  const { suggestions, scoreRequests } = draft(CHORUS, segments, frames(18, -5));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'repeat');
  assert.equal(s.confidence, 'high');
  assert.equal(s.op.type, 'insertLines');
  assert.equal(s.op.afterLine, 3);
  assert.deepEqual(s.op.lines, ['', '바다 멀리 가거라', '함께 노래하자']);
  assert.deepEqual(scoreRequests, []);
  assert.ok(near(s.start, 11) && near(s.end, 17));
  assert.match(s.id, /^t1:repeat:3:[0-9a-f]{8}$/);
  assert.equal(draft(CHORUS, segments, frames(18, -5)).suggestions[0].id, s.id);
});

test('partial-line echo becomes a medium repeat using lyric spelling', () => {
  // 메아리 '저멀리 가거라'는 정규화 6자(minGapChars)이고, 가사 줄 '바다 저 멀리 가거라'의 일부다.
  const lyrics = '하늘 높이 날아라\n\n바다 저 멀리 가거라\n함께 노래하자';
  const segments = [
    seg('하늘 높이 날아라', 0, 3),
    seg('바다 저 멀리 가거라', 4, 7),
    seg('함께 노래하자', 7, 10),
    seg('저멀리 가거라', 11, 13),
  ];
  const { suggestions } = draft(lyrics, segments, frames(14, -5));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'repeat');
  assert.equal(s.confidence, 'medium');
  assert.equal(s.op.type, 'insertLines');
  assert.equal(s.op.afterLine, 3);
  assert.equal(s.op.lines.at(-1), '저 멀리 가거라');
});

test('unknown sung text becomes a new check suggestion with transcript text', () => {
  const segments = [...chorusSegs(), seg('작은 별이 반짝이는 밤', 11, 14)];
  const { suggestions, scoreRequests } = draft(CHORUS, segments, frames(15, -5));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'new');
  assert.equal(s.confidence, 'check');
  assert.deepEqual(s.op, { type: 'insertLines', afterLine: 3, lines: ['작은 별이 반짝이는 밤'] });
  assert.deepEqual(scoreRequests, []);
});

test("line sung as another lyric line asks for a score and maps to that line's spelling", () => {
  const lyrics = '하늘 높이 날아라\n푸른 들판 지나서\n\n구름 위로 올라라\n푸른 들판 지나서';
  const segments = [
    seg('하늘 높이 날아라', 0, 3),
    seg('푸른 들판 지나서', 3, 6),
    seg('하늘 높이 날아라', 8, 11),
    seg('푸른 들판 지나서', 11, 14),
  ];
  const d = draft(lyrics, segments, frames(14, -5));
  assert.equal(d.suggestions.length, 1);
  assert.equal(d.scoreRequests.length, 1);
  const [s] = d.suggestions;
  const [req] = d.scoreRequests;
  assert.equal(s.kind, 'replace');
  assert.deepEqual(s.op, { type: 'replaceLine', lines: [3], from: '구름 위로 올라라', to: '하늘 높이 날아라' });
  assert.deepEqual(req.candidates, ['구름 위로 올라라', '하늘 높이 날아라']);
  assert.equal(req.suggestionId, s.id);
  assert.ok(near(req.start, 7.5) && near(req.end, 11.5));
  const final = finalizeSuggestions(d, { [req.id]: [-100, -4] });
  assert.equal(final.length, 1);
  assert.equal(final[0].confidence, 'high');
  assert.equal(final[0].score, 96);
});

test('word difference across a repeated line is grouped and averaged', () => {
  const lyrics = '내 사랑 노을 아래\n작은 길을 걸어요\n\n내 사랑 노을 아래\n작은 길을 걸어요';
  const segments = [
    seg('나의 사랑 노을 아래', 0, 3),
    seg('작은 길을 걸어요', 3, 6),
    seg('나의 사랑 노을 아래', 8, 11),
    seg('작은 길을 걸어요', 11, 14),
  ];
  const d = draft(lyrics, segments, frames(14, -5));
  assert.equal(d.suggestions.length, 1);
  assert.deepEqual(d.suggestions[0].op, {
    type: 'replaceLine',
    lines: [0, 3],
    from: '내 사랑 노을 아래',
    to: '나의 사랑 노을 아래',
  });
  assert.equal(d.scoreRequests.length, 2);
  const [r0, r1] = d.scoreRequests;
  const medium = finalizeSuggestions(d, { [r0.id]: [-10, -8.5], [r1.id]: [-10, -6.3] });
  assert.equal(medium.length, 1);
  assert.equal(medium[0].lines.length, 2);
  assert.equal(medium[0].confidence, 'medium');
  assert.ok(near(medium[0].score, 2.6));
  assert.deepEqual(finalizeSuggestions(d, { [r0.id]: [-10, -9], [r1.id]: [-10, -8.8] }), []);
});

test('a difference spanning a line break keeps each heard word with the line it was sung in', () => {
  // '걸어가네'→'걸어내'와 '내 사랑'→'나의 사랑'이 2자 안에 붙어 한 차이 구간이 되고, '나'가 앞줄 '네'와 짝지어진다.
  const lyrics = '작은 길을 함께 걸어가네\n내 사랑 노을 아래 빛나네';
  const segments = [seg('작은 길을 함께 걸어내', 0, 4), seg('나의 사랑 노을 아래 빛나네', 4, 8)];
  const d = draft(lyrics, segments, frames(9, -5));
  assert.deepEqual(d.suggestions.map((s) => s.op), [
    { type: 'replaceLine', lines: [0], from: '작은 길을 함께 걸어가네', to: '작은 길을 함께 걸어내' },
    { type: 'replaceLine', lines: [1], from: '내 사랑 노을 아래 빛나네', to: '나의 사랑 노을 아래 빛나네' },
  ]);
  assert.deepEqual(d.scoreRequests.map((r) => r.candidates[1]), ['작은 길을 함께 걸어내', '나의 사랑 노을 아래 빛나네']);
  // 받아쓰기가 두 줄을 한 구간으로 냈으면 경계를 나눌 근거가 없으므로 짝지은 글자의 줄을 따른다.
  const one = draft(lyrics, [seg('작은 길을 함께 걸어내 나의 사랑 노을 아래 빛나네', 0, 8)], frames(9, -5));
  assert.equal(one.suggestions[0].op.to, '작은 길을 함께 걸어내 나');
});

test('lyric-only line with vocal energy is treated as a transcription miss', () => {
  const lyrics = '하늘 높이 날아라\n푸른 들판 지나서\n바다 멀리 가거라';
  const segments = [seg('하늘 높이 날아라', 0, 3), seg('바다 멀리 가거라', 6, 9)];
  assert.deepEqual(draft(lyrics, segments, frames(9, -5)).suggestions, []);
  const { suggestions } = draft(lyrics, segments, frames(9, (t) => (t >= 3 && t < 6 ? -40 : -5)));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'unheard');
  assert.equal(s.confidence, 'check');
  assert.deepEqual(s.op, { type: 'deleteLines', from: 1, to: 1 });
  assert.ok(near(s.start, 3) && near(s.end, 6));
});

test('uncovered loud vocals become unclear, but held notes right after a segment do not', () => {
  const lyrics = '하늘 높이 날아라\n바다 멀리 가거라';
  const segments = [seg('하늘 높이 날아라', 0, 4), seg('바다 멀리 가거라', 4, 8)];
  const loud = (t) => t < 8 || (t >= 8.5 && t < 11.5) || (t >= 20 && t < 23);
  const { suggestions } = draft(lyrics, segments, frames(30, (t) => (loud(t) ? -5 : -40)));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'unclear');
  assert.equal(s.confidence, 'check');
  assert.equal(s.op, null);
  assert.equal(s.hint, '');
  assert.ok(near(s.start, 20) && near(s.end, 23));
});

test('translation lines are ignored for matching and copied with a repeated block', () => {
  const lyrics = [
    '하늘 높이 날아라',
    '',
    '바다 멀리 가거라',
    '(번역: Go far across the sea)',
    '함께 노래하자',
    '(번역: Let us sing together)',
  ].join('\n');
  const segments = [...chorusSegs(), seg('바다 멀리 가거라', 11, 14), seg('함께 노래하자', 14, 17)];
  const { suggestions } = draft(lyrics, segments, frames(18, -5));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'repeat');
  assert.equal(s.confidence, 'high');
  assert.equal(s.op.afterLine, 5);
  assert.deepEqual(s.op.lines, [
    '',
    '바다 멀리 가거라',
    '(번역: Go far across the sea)',
    '함께 노래하자',
    '(번역: Let us sing together)',
  ]);
});

test('empty lyrics with vocals yield one whole-transcript new suggestion', () => {
  const segments = [seg('하늘 높이 날아라', 0, 3), seg('바다 멀리 가거라', 3, 6)];
  const { suggestions } = draft('', segments, frames(6, -5));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'new');
  assert.equal(s.confidence, 'check');
  assert.deepEqual(s.op, { type: 'insertLines', afterLine: -1, lines: ['하늘 높이 날아라', '바다 멀리 가거라'] });
});

test('instrumental track flags vocals above 15% of frames', () => {
  const some = frames(25, (t) => (t < 5 ? -5 : -40));
  const { suggestions } = draft('', [seg('라라 노래해', 1, 4)], some, { instrumental: true });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].kind, 'instrumental');
  assert.equal(suggestions[0].confidence, 'check');
  assert.equal(suggestions[0].op, null);
  const few = frames(25, (t) => (t < 2.5 ? -5 : -40));
  assert.deepEqual(draft('', [], few, { instrumental: true }).suggestions, []);
});

test('lyrics track with no vocal frames is flagged', () => {
  const { suggestions } = draft(CHORUS, [], frames(20, -40));
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].kind, 'no-vocal');
  assert.equal(suggestions[0].confidence, 'check');
  assert.equal(suggestions[0].op, null);
});

test('spacing-only difference yields nothing', () => {
  const d = draft('바람따라 걸어가요', [seg('바람 따라 걸어가요', 0, 3)], frames(3, -5));
  assert.deepEqual(d.suggestions, []);
  assert.deepEqual(d.scoreRequests, []);
});

test('insertion and substitution at the same spot keep the heard text intact', () => {
  const d = draft('가나다라마바사아자차카타', [seg('가나다라마바하늘높이날아고아자차카타', 0, 6)], frames(6, -5));
  assert.equal(d.suggestions.length, 1);
  assert.equal(d.suggestions[0].op.to, '가나다라마바하늘높이날아고아자차카타');
  assert.deepEqual(d.scoreRequests[0].candidates, ['가나다라마바사아자차카타', '가나다라마바하늘높이날아고아자차카타']);
});

test('omitted chorus sung twice with different typos in each copy is still a high repeat', () => {
  // 2번째 부른 후렴의 오타가 1번째 것보다 앞쪽에 있다.
  const copies = [
    [['바다 멀리 가거라', '함께 노래하지'], ['바다 머리 가거라', '함께 노래하자']],
    [['바다 멀리 가거나', '함께 노래하자'], ['바다 머리 가거라', '함께 노래하자']],
  ];
  for (const [[a1, b1], [a2, b2]] of copies) {
    const segments = [
      seg('하늘 높이 날아라', 0, 3),
      seg(a1, 4, 7),
      seg(b1, 7, 10),
      seg(a2, 11, 14),
      seg(b2, 14, 17),
    ];
    const { suggestions } = draft(CHORUS, segments, frames(18, -5));
    assert.equal(suggestions.length, 1, `${a1}/${b1} → ${a2}/${b2}`);
    const [s] = suggestions;
    assert.equal(s.kind, 'repeat');
    assert.equal(s.confidence, 'high');
    assert.deepEqual(s.op, { type: 'insertLines', afterLine: 3, lines: ['', '바다 멀리 가거라', '함께 노래하자'] });
    assert.ok(near(s.start, 11) && near(s.end, 17));
  }
});

test('a heard line closer to its own line is not remapped to a similar other line', () => {
  const lyrics = '내 사랑 노을 아래\n나의 사랑 노을 위에';
  const segments = [seg('나의 사랑 노을 아래', 0, 3), seg('나의 사랑 노을 위에', 3, 6)];
  const d = draft(lyrics, segments, frames(6, -5));
  assert.equal(d.suggestions.length, 1);
  assert.equal(d.suggestions[0].op.to, '나의 사랑 노을 아래');
  assert.deepEqual(d.scoreRequests[0].candidates, ['내 사랑 노을 아래', '나의 사랑 노을 아래']);
});

// ── '다르게 불림' 검증: 가사 줄을 프롬프트로 다시 받아쓴 결과(redecode)가 받아쓴 줄을 지지해야 남는다 ──
const ONE_LINE = '하늘 높이 날아라\n푸른 들판 지나서';
const oneLineSegs = () => [seg('하늘 높이 날아라', 0, 3), seg('푸른 바다 건너서', 3, 6)];

test('a replace is dropped when the lyric-prompted re-decode agrees with the lyric and kept when it agrees with the hearing', () => {
  const d = draft(ONE_LINE, oneLineSegs(), frames(6, -5));
  assert.equal(d.suggestions.length, 1);
  assert.deepEqual(d.suggestions[0].op.to, '푸른 바다 건너서');
  const [req] = d.scoreRequests;
  const scores = { [req.id]: [-20, -15] };
  const kept = finalizeSuggestions(d, scores, { [req.id]: '푸른 바다 건너서' });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].confidence, 'medium');
  assert.equal(kept[0].score, 5);
  assert.deepEqual(finalizeSuggestions(d, scores, { [req.id]: '푸른 들판 지나서' }), []);
  // 다시 받아쓴 글이 어느 쪽도 지지하지 않으면(support 0) 버린다.
  assert.deepEqual(finalizeSuggestions(d, scores, { [req.id]: '' }), []);
  // 다시 받아쓴 결과가 없으면 지금까지처럼 점수만으로 판정한다.
  assert.equal(finalizeSuggestions(d, scores, {})[0].confidence, 'medium');
  assert.equal(finalizeSuggestions(d, scores)[0].confidence, 'medium');
});

test('minor spelling regions of a proposal carry no evidence in the re-decode support', () => {
  // 다시 받아쓴 글이 '내→나의'는 지지하고 작은 차이 '켜졌어→켜져서'만 가사 쪽으로 돌아갔다.
  // 줄 전체 유사도로는 −0.04지만, 작은 차이 구간을 빼고 보면 제안을 지지한다.
  const d = draft('내 꿈에 파란불이 켜져서', [seg('나의 꿈에 파란불이 켜졌어', 0, 4)], frames(4, -5));
  assert.equal(d.suggestions[0].op.to, '나의 꿈에 파란불이 켜졌어');
  const [req] = d.scoreRequests;
  const kept = finalizeSuggestions(d, { [req.id]: [-20, -15] }, { [req.id]: '나의 꿈에 파란불이 켜져서' });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].op.to, '나의 꿈에 파란불이 켜졌어');
  assert.equal(kept[0].confidence, 'medium');
  // 실질 차이까지 가사로 돌아가면 버린다.
  assert.deepEqual(finalizeSuggestions(d, { [req.id]: [-20, -15] }, { [req.id]: '내 꿈에 파란불이 켜졌어' }), []);
});

test('grouped occurrences average their re-decode support', () => {
  const lyrics = '내 사랑 노을 아래\n작은 길을 걸어요\n\n내 사랑 노을 아래\n작은 길을 걸어요';
  const segments = [
    seg('나의 사랑 노을 아래', 0, 3),
    seg('작은 길을 걸어요', 3, 6),
    seg('나의 사랑 노을 아래', 8, 11),
    seg('작은 길을 걸어요', 11, 14),
  ];
  const d = draft(lyrics, segments, frames(14, -5));
  const [r0, r1] = d.scoreRequests;
  const scores = { [r0.id]: [-10, -6], [r1.id]: [-10, -6] };
  // +0.2와 −0.06의 평균은 0보다 크다.
  const kept = finalizeSuggestions(d, scores, { [r0.id]: '나의 사랑 노을 아래', [r1.id]: '노을 아래' });
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].lines, [0, 3]);
  assert.equal(kept[0].confidence, 'medium');
  // +0.2와 −0.2의 평균은 0이므로 버린다.
  assert.deepEqual(finalizeSuggestions(d, scores, { [r0.id]: '나의 사랑 노을 아래', [r1.id]: '내 사랑 노을 아래' }), []);
});

test("'high' needs a remap to another lyric line or two supported occurrences", () => {
  const strong = (d) => Object.fromEntries(d.scoreRequests.map((r) => [r.id, [-40, -10]]));
  // 한 번만, 다른 줄로 바꾼 것도 아니면 Δ가 커도 보통이다.
  const single = draft(ONE_LINE, oneLineSegs(), frames(6, -5));
  const [sr] = single.scoreRequests;
  assert.equal(finalizeSuggestions(single, strong(single), { [sr.id]: '푸른 바다 건너서' })[0].confidence, 'medium');
  assert.equal(finalizeSuggestions(single, strong(single))[0].confidence, 'high');
  // 두 번 모두 지지하면 강함, 한 번만 지지하면 보통이다.
  const lyrics = '내 사랑 노을 아래\n작은 길을 걸어요\n\n내 사랑 노을 아래\n작은 길을 걸어요';
  const segments = [
    seg('나의 사랑 노을 아래', 0, 3),
    seg('작은 길을 걸어요', 3, 6),
    seg('나의 사랑 노을 아래', 8, 11),
    seg('작은 길을 걸어요', 11, 14),
  ];
  const twice = draft(lyrics, segments, frames(14, -5));
  const [t0, t1] = twice.scoreRequests;
  const both = finalizeSuggestions(twice, strong(twice), { [t0.id]: '나의 사랑 노을 아래', [t1.id]: '나의 사랑 노을 아래' });
  assert.equal(both[0].confidence, 'high');
  const once = finalizeSuggestions(twice, strong(twice), { [t0.id]: '나의 사랑 노을 아래', [t1.id]: '노을 아래' });
  assert.equal(once[0].confidence, 'medium');
  // 다른 가사 줄로 바꾼 제안은 한 번이어도 강함이 될 수 있다.
  const remap = draft(
    '하늘 높이 날아라\n푸른 들판 지나서\n\n구름 위로 올라라\n푸른 들판 지나서',
    [seg('하늘 높이 날아라', 0, 3), seg('푸른 들판 지나서', 3, 6), seg('하늘 높이 날아라', 8, 11), seg('푸른 들판 지나서', 11, 14)],
    frames(14, -5),
  );
  const [rr] = remap.scoreRequests;
  assert.equal(remap.suggestions[0].op.to, '하늘 높이 날아라');
  assert.equal(finalizeSuggestions(remap, strong(remap), { [rr.id]: '하늘 높이 날아라' })[0].confidence, 'high');
});

test('spelling or pronunciation-only differences are not drafted (both directions)', () => {
  const pairs = [
    ['눈 위에 발자욱 남기고', '눈 위에 발자국 남기고'],
    ['봄은 다시 올꺼야', '봄은 다시 올 거야'],
    ['꽃을 꺽지 말아요', '꽃을 꺾지 말아요'],
    ['내마음 너에게 줄게', '내 맘 너에게 줄게'],
    ['가슴이 뛴답니다 오늘도', '가슴이 찐답니다 오늘도'],
    ['작은 사랑도 소중해', '작은 사람도 소중해'],
    ['하루가 또 지나니', '하루가 또 지났니'],
    ['바람이 멈쳐도 걸어요', '바람이 멈춰도 걸어요'],
  ];
  for (const [a, b] of pairs) {
    for (const [lyric, heard] of [[a, b], [b, a]]) {
      const d = draft(lyric, [seg(heard, 0, 4)], frames(4, -5));
      assert.deepEqual(d.suggestions, [], `${lyric} → ${heard}`);
      assert.deepEqual(d.scoreRequests, [], `${lyric} → ${heard}`);
    }
  }
});

test('a line with any real wording difference is still drafted', () => {
  const cases = [
    // 내→나의는 자모 거리 3이다(켜져서→켜졌어는 작은 차이지만 줄 전체를 거르지는 않는다).
    ['내 꿈에 파란불이 켜져서', '나의 꿈에 파란불이 켜졌어'],
    ['구름 따라 가요 가요', '구름 따라 달려가요'],
    ['괜찮나요 이제는', '괜찮나요 괜찮나요 이제는'],
  ];
  for (const [lyric, heard] of cases) {
    const d = draft(lyric, [seg(heard, 0, 4)], frames(4, -5));
    assert.equal(d.suggestions.length, 1, `${lyric} → ${heard}`);
    assert.equal(d.suggestions[0].kind, 'replace');
    assert.equal(normalizeText(d.suggestions[0].op.to).norm, normalizeText(heard).norm);
  }
});

test('a heard line clearly closer to another lyric line is remapped to it even below repeatSimilarity', () => {
  // 받아쓴 줄 '하늘멀리날아봐요': 다른 줄과 0.62, 자기 줄과 0.44 → 다른 줄 표기로 바꾼다.
  const far = draft('하늘 높이 날아가요\n바다 멀리 노래하며 봐요', [seg('하늘 높이 날아가요', 0, 3), seg('하늘 멀리 날아봐요', 3, 6)], frames(6, -5));
  assert.equal(far.suggestions.length, 1);
  assert.deepEqual(far.suggestions[0].op, { type: 'replaceLine', lines: [1], from: '바다 멀리 노래하며 봐요', to: '하늘 높이 날아가요' });
  // 다른 줄 0.62, 자기 줄 0.58이면 0.1 넘게 가깝지 않으므로 받아쓴 글 그대로 둔다.
  const close = draft('하늘 높이 날아가요\n하늘 멀리 노래해 봐라', [seg('하늘 높이 날아가요', 0, 3), seg('하늘 멀리 날아봐요', 3, 6)], frames(6, -5));
  assert.equal(close.suggestions.length, 1);
  assert.equal(normalizeText(close.suggestions[0].op.to).norm, '하늘멀리날아봐요');
});

// ── 삽입 구간의 남은 앞·뒤 ──
const heardNorm = (list) => list.map((s) => normalizeText(s.kind === 'new' ? s.op.lines.join(' ') : s.hint).norm).join('');

test('a repeated tail right after an omitted chorus extends the same repeat insert', () => {
  const lyrics = ['하늘 높이 날아라', '', '바다 멀리 가거라', '함께 노래하자 내일이 오니까', '', '작은 별이 반짝여요'].join('\n');
  const segments = [
    seg('하늘 높이 날아라', 0, 3),
    seg('바다 멀리 가거라', 4, 7),
    seg('함께 노래하자 내일이 오니까', 7, 11),
    seg('작은 별이 반짝여요', 12, 15),
    seg('바다 멀리 가거라', 16, 19),
    seg('함께 노래하자 내일이 오니까', 19, 23),
    seg('내일이 오니까', 24, 26),
  ];
  const { suggestions } = draft(lyrics, segments, frames(27, -5));
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.kind, 'repeat');
  assert.equal(s.confidence, 'high');
  assert.deepEqual(s.op, { type: 'insertLines', afterLine: 5, lines: ['', '바다 멀리 가거라', '함께 노래하자 내일이 오니까', '내일이 오니까'] });
  assert.ok(near(s.start, 16) && near(s.end, 26));
  assert.equal(heardNorm(suggestions), normalizeText('바다 멀리 가거라 함께 노래하자 내일이 오니까 내일이 오니까').norm);
});

test('unknown sung text before a repeated block becomes its own new suggestion', () => {
  const lyrics = ['하늘 높이 날아라', '바다 멀리 가거라', '', '함께 노래하자', '오늘 밤도 함께해'].join('\n');
  const segments = [
    seg('하늘 높이 날아라', 0, 3),
    seg('바다 멀리 가거라', 3, 6),
    seg('함께 노래하자', 7, 10),
    seg('오늘 밤도 함께해', 10, 13),
    seg('우우우 예예예', 14, 17),
    seg('하늘 높이 날아라', 18, 21),
    seg('바다 멀리 가거라', 21, 24),
  ];
  const { suggestions } = draft(lyrics, segments, frames(25, -5));
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['new', 'check'], ['repeat', 'high']]);
  const [chorus, verse] = suggestions;
  assert.deepEqual(chorus.op, { type: 'insertLines', afterLine: 4, lines: ['우우우 예예예'] });
  assert.ok(near(chorus.start, 14) && near(chorus.end, 17));
  assert.deepEqual(verse.op, { type: 'insertLines', afterLine: 4, lines: ['하늘 높이 날아라', '바다 멀리 가거라'] });
  assert.ok(near(verse.start, 18) && near(verse.end, 24));
  assert.equal(heardNorm(suggestions), normalizeText('우우우 예예예 하늘 높이 날아라 바다 멀리 가거라').norm);
});

test('a leftover that repeats a different lyric block becomes an additional repeat', () => {
  const lyrics = ['작은 새야 노래해', '', '하늘 높이 날아라', '바다 멀리 가거라', '함께 노래하자', '', '별빛 속에 춤을 춰봐요'].join('\n');
  const segments = [
    seg('작은 새야 노래해', 0, 3),
    seg('하늘 높이 날아라', 4, 7),
    seg('바다 멀리 가거라', 7, 10),
    seg('함께 노래하자', 10, 13),
    seg('별빛 속에 춤을 춰봐요', 14, 17),
    seg('하늘 높이 날아라', 18, 21),
    seg('바다 멀리 가거라', 21, 24),
    seg('함께 노래하자', 24, 27),
    seg('작은 새야 노래해', 28, 31),
  ];
  const { suggestions } = draft(lyrics, segments, frames(32, -5));
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence, s.op.afterLine]), [['repeat', 'high', 6], ['repeat', 'high', 6]]);
  const [chorus, bird] = suggestions;
  assert.deepEqual(chorus.op.lines, ['', '하늘 높이 날아라', '바다 멀리 가거라', '함께 노래하자']);
  assert.ok(near(chorus.start, 18) && near(chorus.end, 27));
  assert.deepEqual(bird.op.lines, ['작은 새야 노래해']);
  assert.ok(near(bird.start, 28) && near(bird.end, 31));
  assert.equal(heardNorm(suggestions), normalizeText('하늘 높이 날아라 바다 멀리 가거라 함께 노래하자 작은 새야 노래해').norm);
});

// ── 블록 가장자리가 뭉개져 들린 반복 후렴 ──
const EDGE_LYRICS = ['하늘 높이 날아라', '', '오 그대여', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까', '', '작은 별이 반짝여요'].join('\n');
const EDGE_BLOCK = ['', '오 그대여', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까'];
const edgeSegs = (second) => [
  seg('하늘 높이 날아라', 0, 3),
  seg('오 그대여', 4, 6),
  seg('바다 멀리 가거라 저 하늘 끝까지', 6, 11),
  seg('함께 노래하자 내일이 오니까', 11, 15),
  seg('작은 별이 반짝여요', 16, 19),
  ...second,
];

test('an omitted chorus whose head was misheard is still one high repeat of the whole block', () => {
  const segments = edgeSegs([
    seg('오 그대여', 20, 22),
    seg('파타 뭘니 가거라 저 하늘 끝까지', 22, 27),
    seg('함께 노래하자 내일이 오니까', 27, 31),
  ]);
  const { suggestions } = draft(EDGE_LYRICS, segments, frames(32, -5));
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']]);
  assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK });
  assert.ok(near(suggestions[0].start, 20) && near(suggestions[0].end, 31));
});

// 맞춘 구간(core) 밖에서 받아쓴 글자는 뭉개진 끝자락이든 다른 노래든 반복 구절에 넣지 않는다(판정 R21).
// 반복 구절은 덮인 비율 0.5 이상인 줄을 통째로 넣고, 남은 받아쓴 글자는 6자 이상이면 새 구절, 아니면 버린다.
const N = (text) => normalizeText(text).norm;
const CHORUS_HEARD = '오 그대여 바다 멀리 가거라 저 하늘 끝까지 함께 노래하자';
const chorusHead = () => [seg('오 그대여', 20, 22), seg('바다 멀리 가거라 저 하늘 끝까지', 22, 27)];
// 강함 제안의 줄은 모두 가사의 온전한 줄(또는 빈 줄)이어야 한다.
const wholeLinesOnly = (list, lyricsText, label) => {
  const own = new Set(lyricsText.split('\n'));
  for (const s of list.filter((x) => x.confidence === 'high')) {
    for (const line of s.op.lines) assert.ok(own.has(line), `${label}: 강함 제안에 줄 일부 '${line}'`);
  }
};

test('a misheard chorus tail keeps one high repeat of the whole block and never puts the garbled text inside it', () => {
  // 마지막 줄 '함께 노래하자 내일이 오니까'(12자)는 어느 경우든 절반 이상 맞는다. 반복 구절의 받아쓴 범위는 맞춘 구간
  // (정확히 맞은 글자로 끝난다)을 낱말 경계에 맞춘 데까지다. 그 뒤 끝자락은 6자 이상이면 새 구절, 아니면 버린다.
  const tails = [
    ['냬닐리 우닉가', ''], ['내닐리 우닉가', ''], ['냬닐니 우닛가', ''],
    ['내일이 우닛가', '내일이'], ['내일이 오닉가요', '내일이'], ['내이리 오니가요', '내이리'], ['나일이 오니가요', '나일이'],
  ];
  for (const [tail, inRepeat] of tails) {
    const { suggestions } = draft(EDGE_LYRICS, edgeSegs([...chorusHead(), seg(`함께 노래하자 ${tail}`, 27, 31)]), frames(32, -5));
    const [repeat, ...rest] = suggestions;
    assert.deepEqual([repeat.kind, repeat.confidence], ['repeat', 'high'], tail);
    assert.deepEqual(repeat.op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK }, tail);
    assert.ok(near(repeat.start, 20), tail);
    // 남은 글자만 새 구절에 들어간다(겹치는 글자 없이).
    const full = N(`${CHORUS_HEARD} ${tail}`);
    const hint = N(repeat.hint);
    assert.equal(hint, N(`${CHORUS_HEARD} ${inRepeat}`), tail);
    const left = full.slice(hint.length);
    if (left.length >= THRESHOLDS.minGapChars) {
      assert.deepEqual(rest.map((s) => [s.kind, s.confidence, s.op.afterLine, N(s.op.lines.join(' '))]), [['new', 'check', 6, left]], tail);
    } else {
      assert.deepEqual(rest, [], tail);
    }
  }
});

test('a misheard first line at the very start of a block never starts the repeat mid-line', () => {
  const lyrics = ['하늘 높이 날아라', '', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까', '', '작은 별이 반짝여요'].join('\n');
  const first = [seg('하늘 높이 날아라', 0, 3), seg('바다 멀리 가거라 저 하늘 끝까지', 4, 9), seg('함께 노래하자 내일이 오니까', 9, 13), seg('작은 별이 반짝여요', 14, 17)];
  const second = (head) => [...first, seg(head, 18, 23), seg('함께 노래하자 내일이 오니까', 23, 27)];
  // 첫 줄이 절반 넘게 맞으면(9/13) 블록 전체가 강함이다. 맞춘 구간 밖의 '파타 뭘니'(4자)는 버린다.
  const covered = draft(lyrics, second('파타 뭘니 가거라 저 하늘 끝까지'), frames(28, -5)).suggestions;
  assert.deepEqual(covered.map((s) => [s.kind, s.confidence]), [['repeat', 'high']]);
  assert.deepEqual(covered[0].op, { type: 'insertLines', afterLine: 5, lines: ['', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까'] });
  assert.equal(N(covered[0].hint), N('가거라 저 하늘 끝까지 함께 노래하자 내일이 오니까'));
  assert.ok(covered[0].start > 18 && near(covered[0].end, 27));
  // 첫 줄이 절반도 안 맞으면 그 줄을 뺀 보통이고, 받아쓴 첫 줄은 새 구절로 따로 둔다.
  const garbled = draft(lyrics, second('파타 뭘니 바거나 처 아늘 끝까지'), frames(28, -5)).suggestions;
  assert.deepEqual(garbled.map((s) => [s.kind, s.confidence]), [['new', 'check'], ['repeat', 'medium']]);
  assert.deepEqual(garbled[0].op, { type: 'insertLines', afterLine: 5, lines: ['파타 뭘니 바거나 처 아늘 끝까지'] });
  assert.deepEqual(garbled[1].op, { type: 'insertLines', afterLine: 5, lines: ['함께 노래하자 내일이 오니까'] });
});

test('a misheard chorus tail followed by a separate ad-lib keeps the repeat high and puts the leftover in new', () => {
  for (const tail of ['냬닐리 우닉가', '내일이 오닉가요', '냬닐니 우닛가']) {
    for (const adlib of ['우우 예예예', '우우우 예예예', '우우우 예예예 라라라', '우우우 예예예 라라라 랄랄라']) {
      const label = `${tail} + ${adlib}`;
      const segments = edgeSegs([...chorusHead(), seg(`함께 노래하자 ${tail}`, 27, 31), seg(adlib, 32, 36)]);
      const { suggestions } = draft(EDGE_LYRICS, segments, frames(37, -5));
      // 후렴이 통째로 새 구절이 되지 않는다: 첫 제안이 블록 전체의 강함 반복이고, 나머지는 확인 필요 새 구절이다.
      const [repeat, ...rest] = suggestions;
      assert.deepEqual([repeat.kind, repeat.confidence], ['repeat', 'high'], label);
      assert.deepEqual(repeat.op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK }, label);
      assert.ok(near(repeat.start, 20), label);
      assert.ok(rest.length >= 1 && rest.every((s) => s.kind === 'new' && s.confidence === 'check' && s.op.afterLine === 6), label);
      assert.ok(near(rest.at(-1).end, 36), label);
      // 남은 글자(끝자락 + 애드리브)는 모두 6자 이상이므로 버려지는 글자가 없다: 모든 받아쓴 글자가 꼭 한 번씩 나온다.
      assert.equal(heardNorm(suggestions), N(`${CHORUS_HEARD} ${tail} ${adlib}`), label);
    }
  }
});

test('unrelated sung lines after a chorus heard only partway are never put inside a high repeat', () => {
  const lines = ['우리가 함께 춤춰요', '어디가 예예예 예', '이제 안녕 내 사랑', '하얀 눈이 내리면', '어디에 있나요', '아이야 이리 오너라', '어디까지 가니', '비가 오는 날에'];
  for (const stop of ['함께 노래하자', '함께 노래하자 내일이']) {
    for (const line of lines) {
      const cases = [
        [`${stop} ${line} (같은 구간)`, [seg(`${stop} ${line}`, 27, 34)]],
        [`${stop} | ${line} (다른 구간)`, [seg(stop, 27, 30), seg(line, 31, 34)]],
      ];
      for (const [label, tail] of cases) {
        const { suggestions } = draft(EDGE_LYRICS, edgeSegs([...chorusHead(), ...tail]), frames(35, -5));
        assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high'], ['new', 'check']], label);
        const [repeat, extra] = suggestions;
        // 마지막 줄은 절반 이상 맞으므로 블록 전체를 넣는다. 받아쓴 힌트에는 다른 줄의 글자가 한 자도 없다.
        assert.deepEqual(repeat.op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK }, label);
        assert.equal(N(repeat.hint), N(`오 그대여 바다 멀리 가거라 저 하늘 끝까지 ${stop}`), label);
        assert.deepEqual(extra.op, { type: 'insertLines', afterLine: 6, lines: [line] }, label);
        wholeLinesOnly(suggestions, EDGE_LYRICS, label);
      }
    }
  }
});

test('a block edge line heard below half is left out and its fragment is never merged into a high repeat', () => {
  // 마지막 줄 '함께 노래하자 내일이 오니까 우리 모두'(16자) 중 6–7자만 들렸다.
  const lyrics = ['하늘 높이 날아라', '', '오 그대여', '바다 멀리 가거라', '함께 노래하자 내일이 오니까 우리 모두', '', '작은 별이 반짝여요'].join('\n');
  const first = [seg('하늘 높이 날아라', 0, 3), seg('오 그대여', 4, 6), seg('바다 멀리 가거라', 6, 9), seg('함께 노래하자 내일이 오니까 우리 모두', 9, 14), seg('작은 별이 반짝여요', 15, 18)];
  for (const last of ['함께 노래하자 내', '함께 노래하자']) {
    for (const adlib of [[], [seg('우우우 예예예', 29, 31)]]) {
      const label = `${last}${adlib.length ? ' + 애드리브' : ''}`;
      const segments = [...first, seg('오 그대여', 20, 22), seg('바다 멀리 가거라', 22, 25), seg(last, 25, 28), ...adlib];
      const { suggestions } = draft(lyrics, segments, frames(32, -5));
      wholeLinesOnly(suggestions, lyrics, label);
      assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'medium'], ['repeat', 'medium'], ...adlib.map(() => ['new', 'check'])], label);
      const [block, piece] = suggestions;
      assert.deepEqual(block.op, { type: 'insertLines', afterLine: 6, lines: ['오 그대여', '바다 멀리 가거라'] }, label);
      assert.deepEqual(piece.op, { type: 'insertLines', afterLine: 6, lines: [last] }, label);
    }
  }
  // 첫 줄 쪽도 같다: '저 멀리 푸른 바다 건너 오 그대여'(14자) 중 '건너 오 그대여'만 들렸다.
  const lyricsH = ['하늘 높이 날아라', '', '저 멀리 푸른 바다 건너 오 그대여', '바다 멀리 가거라', '함께 노래하자', '', '작은 별이 반짝여요'].join('\n');
  const firstH = [seg('하늘 높이 날아라', 0, 3), seg('저 멀리 푸른 바다 건너 오 그대여', 4, 8), seg('바다 멀리 가거라', 8, 11), seg('함께 노래하자', 11, 14), seg('작은 별이 반짝여요', 15, 18)];
  const { suggestions } = draft(lyricsH, [...firstH, seg('건너 오 그대여', 20, 23), seg('바다 멀리 가거라', 23, 26), seg('함께 노래하자', 26, 29)], frames(30, -5));
  wholeLinesOnly(suggestions, lyricsH, '건너 오 그대여');
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence, s.op.lines]), [
    ['repeat', 'medium', ['건너 오 그대여']],
    ['repeat', 'medium', ['바다 멀리 가거라', '함께 노래하자']],
  ]);
});

// 맞춘 구간(core)은 블록 안쪽이 뭉개진 곳만 넘어 넓힌다(판정 R23). 후렴 끝에서 이어 부른 다른 노래는 첫 낱말이 우연히
// 몇 글자 맞아도(일치와 나머지가 같은 수여도) 반복 구절에 들어가지 않는다.
test('an unrelated line right after a chorus heard partway never lends its first words to the high repeat', () => {
  const cases = [
    ['함께 노래하자', ['사랑이 오나요', '봄이 오면 만나', '눈이 오는 밤에', '그 일은 잊어요', '매일 밤 너를 그려', '나일 강의 노을', '어제 일이 생각나']],
    ['함께 노래하자 내일이', ['네가 오니 좋아', '비가 오니 슬퍼', '또 오네 그 사람', '이리 오너라 얘야', '모레 오니 기다려']],
  ];
  for (const [stop, lines] of cases) {
    for (const line of lines) {
      for (const [label, tail] of [
        [`${stop} ${line}`, [seg(`${stop} ${line}`, 27, 34)]],
        [`${stop} | ${line}`, [seg(stop, 27, 30), seg(line, 31, 34)]],
      ]) {
        const { suggestions } = draft(EDGE_LYRICS, edgeSegs([...chorusHead(), ...tail]), frames(35, -5));
        assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high'], ['new', 'check']], label);
        const [repeat, extra] = suggestions;
        assert.deepEqual(repeat.op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK }, label);
        assert.equal(N(repeat.hint), N(`오 그대여 바다 멀리 가거라 저 하늘 끝까지 ${stop}`), label);
        assert.deepEqual(extra.op, { type: 'insertLines', afterLine: 6, lines: [line] }, label);
      }
    }
  }
  // 마지막 줄이 절반도 안 들렸을 때도 이어 부른 노래의 가운데 글자('일이')로 그 줄을 채워 강함으로 만들지 않는다.
  for (const tail of [[seg('함께 노래하 어제 일이 생각나', 27, 34)], [seg('함께 노래하', 27, 30), seg('어제 일이 생각나', 31, 34)]]) {
    const { suggestions } = draft(EDGE_LYRICS, edgeSegs([...chorusHead(), ...tail]), frames(35, -5));
    assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'medium'], ['new', 'check']]);
    assert.deepEqual(suggestions[0].op.lines, ['오 그대여', '바다 멀리 가거라 저 하늘 끝까지']);
    assert.equal(N(suggestions[1].op.lines.join(' ')), N('함께 노래하 어제 일이 생각나'));
  }
});

test('a line garbled in its middle at the start of a block is still one high repeat', () => {
  // 첫 줄의 처음('바다 멀리')은 맞고 가운데가 뭉개졌다. 맞춘 구간이 그 줄의 처음까지 닿아 줄을 절반 넘게 덮으면 넓힌다.
  const lyrics = ['하늘 높이 날아라', '', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까', '', '작은 별이 반짝여요'].join('\n');
  const first = [seg('하늘 높이 날아라', 0, 3), seg('바다 멀리 가거라 저 하늘 끝까지', 4, 9), seg('함께 노래하자 내일이 오니까', 9, 13), seg('작은 별이 반짝여요', 14, 17)];
  for (const head of ['바다 멀리 까꺼나 처 하늘 끝까지', '바다 멀리 파타 뭘니 하늘 끝까지']) {
    const { suggestions } = draft(lyrics, [...first, seg(head, 18, 23), seg('함께 노래하자 내일이 오니까', 23, 27)], frames(28, -5));
    assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']], head);
    assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 5, lines: ['', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까'] }, head);
    assert.equal(N(suggestions[0].hint), N(`${head} 함께 노래하자 내일이 오니까`), head);
  }
});

// 앞뒤 애드리브가 이웃 연(빈 줄로 나뉜 블록)의 한두 글자에 맞아도, 그 줄은 반복 구절의 블록 밖이므로 빠진 줄로 치지 않는다.
test('a fully heard repeat stays high when an ad-lib touches a line of the neighbouring stanza', () => {
  const full = () => [...chorusHead(), seg('함께 노래하자 내일이 오니까', 27, 31)];
  const cases = [
    ...['라라', '랄라라', '아이', '날아라', '예 날아라', '그래 날아라'].map((a) => [`앞 «${a}»`, [seg(a, 18, 19.5), ...full()]]),
    ...['작아', '작은', '오오'].map((a) => [`뒤 «${a}»`, [...full(), seg(a, 31.5, 33)]]),
  ];
  for (const [label, segs] of cases) {
    const { suggestions } = draft(EDGE_LYRICS, edgeSegs(segs), frames(34, -5));
    // 애드리브는 6자가 안 되므로 버리고, 블록 앞 빈 줄까지 그대로 둔 강함 하나만 남는다.
    assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']], label);
    assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK }, label);
    assert.ok(near(suggestions[0].start, 20) && near(suggestions[0].end, 31), label);
  }
  // 블록 뒤 줄이 '오'로 시작하거나 앞 줄이 '요'로 끝나는 경우도 같다.
  const lyrics = ['하늘 높이 날아가요', '', '오 그대여', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까', '', '오 나의 사랑 작은 별이여'].join('\n');
  const first = [seg('하늘 높이 날아가요', 0, 3), seg('오 그대여', 4, 6), seg('바다 멀리 가거라 저 하늘 끝까지', 6, 11), seg('함께 노래하자 내일이 오니까', 11, 15), seg('오 나의 사랑 작은 별이여', 16, 19)];
  for (const [label, segs] of [['뒤 «오 예»', [...full(), seg('오 예', 31.5, 33)]], ['앞 «그래요»', [seg('그래요', 18, 19.5), ...full()]]]) {
    const { suggestions } = draft(lyrics, [...first, ...segs], frames(34, -5));
    assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence, s.op.afterLine, s.op.lines]), [['repeat', 'high', 6, EDGE_BLOCK]], label);
  }
});

// 제자리 창에서 반복 구절을 찾았으면 창을 옮기지 않는다(판정 R23). 옮긴 창이 첫 번째로 부른 쪽을 반복으로 잡으면
// '오 그대여'가 빠지고 한 번만 부른 줄이 두 번 들어간다.
test('a window shift never replaces a repeat found in place, so the high suggestion applies to the right lyrics', () => {
  const full = () => [...chorusHead(), seg('함께 노래하자 내일이 오니까', 27, 31)];
  const want = [...EDGE_LYRICS.split('\n'), ...EDGE_BLOCK].join('\n');
  const cases = [
    ...['예 날아라', '우 날아라', '오 날아라', '날아라 날아라'].map((a) => [`앞 «${a}»`, [seg(a, 18, 19.5), ...full()]]),
    ...['예예 작은', '작은 별'].map((a) => [`뒤 «${a}»`, [...full(), seg(a, 31.5, 33)]]),
    // 남은 글자가 많아 창을 옮겨 보더라도, 두 벌 사이에 한 번만 부른 연('작은 별이 반짝여요')을 건너뛰지 않는다.
    ['끝자락 + 애드리브', [...chorusHead(), seg('함께 노래하자 내일이 오닉가요', 27, 31), seg('예 예 예 예 예 예 예', 32, 34)]],
  ];
  for (const [label, segs] of cases) {
    const { suggestions } = draft(EDGE_LYRICS, edgeSegs(segs), frames(35, -5));
    const highs = suggestions.filter((s) => s.confidence === 'high');
    assert.equal(highs.length, 1, label);
    assert.deepEqual(highs[0].op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK }, label);
    assert.ok(near(highs[0].start, 20), label);
    assert.equal(applySuggestions(EDGE_LYRICS, suggestions, highs.map((s) => ({ suggestionId: s.id }))), want, label);
  }
});

test('a chorus sung twice in a row in lyrics without blank lines is one high repeat', () => {
  // 빈 줄 없이 쓴 가사는 연을 가릴 수 없으므로, 옮긴 창은 줄마다 덮였으면(강함) 받아들인다.
  const lyrics = ['하늘 높이 날아라', '바다 멀리 가거라', '함께 노래하자 내일이 오니까', '저 하늘 끝까지 날아가요', '작은 별이 반짝여요'].join('\n');
  const segments = [
    seg('하늘 높이 날아라', 0, 3),
    seg('바다 멀리 가거라', 4, 7), seg('함께 노래하지 내일이 오니까', 7, 11), seg('저 하늘 끝까지 날아가요', 11, 14),
    seg('바다 머리 가거라', 15, 18), seg('함께 노래하자 내일이 오니까', 18, 22), seg('저 하늘 끝까지 날아가요', 22, 25),
    seg('작은 별이 반짝여요', 26, 29),
  ];
  const { suggestions } = draft(lyrics, segments, frames(30, -5));
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']]);
  assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 3, lines: ['바다 멀리 가거라', '함께 노래하자 내일이 오니까', '저 하늘 끝까지 날아가요'] });
  assert.ok(near(suggestions[0].start, 15) && near(suggestions[0].end, 25));
});

test('a repeat starting mid-word snaps to the word boundary inside the repeat', () => {
  // core가 '뭘리'의 '리'에서 시작한다. 앞뒤 경계가 한 글자씩 같은 거리면 반복 구절 안쪽('가거라' 앞)으로 자른다.
  const lyrics = ['하늘 높이 날아라', '', '바다 멀리 가거라 저 하늘 끝까지', '함께 노래하자 내일이 오니까', '', '작은 별이 반짝여요'].join('\n');
  const first = [seg('하늘 높이 날아라', 0, 3), seg('바다 멀리 가거라 저 하늘 끝까지', 4, 9), seg('함께 노래하자 내일이 오니까', 9, 13), seg('작은 별이 반짝여요', 14, 17)];
  const { suggestions } = draft(lyrics, [...first, seg('바타 뭘리 가거라 저 하늘 끝까지', 18, 23), seg('함께 노래하자 내일이 오니까', 23, 27)], frames(28, -5));
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']]);
  assert.equal(suggestions[0].hint, '가거라 저 하늘 끝까지 함께 노래하자 내일이 오니까');
});

test('a lyric phrase that opens a new verse after the chorus is not merged into the high repeat', () => {
  // '저 하늘 끝까지'는 블록 안 줄의 일부지만 뒤에 다른 노래가 이어 붙었다: 메아리로 보고 강함에 붙이지 않는다.
  const segments = edgeSegs([...chorusHead(), seg('함께 노래하자 내일이 오니까', 27, 31), seg('저 하늘 끝까지 너와 함께라면 좋아', 32, 37)]);
  const { suggestions } = draft(EDGE_LYRICS, segments, frames(38, -5));
  wholeLinesOnly(suggestions, EDGE_LYRICS, '새 절');
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence, s.op.lines]), [
    ['repeat', 'high', EDGE_BLOCK],
    ['repeat', 'medium', ['저 하늘 끝까지']],
    ['new', 'check', ['너와 함께라면 좋아']],
  ]);
  assert.equal(heardNorm(suggestions), N(`${CHORUS_HEARD} 내일이 오니까 저 하늘 끝까지 너와 함께라면 좋아`));
});

// ── 창 옮기기(reanchor)는 줄마다 확인한 회전만 받는다(판정 R26) ──
const SIX = { A: '하늘 높이 날아라', B: '바다 멀리 가거라', C: '함께 노래하자 내일이 오니까', D: '저 하늘 끝까지 날아가요', E: '작은 별이 반짝여요', F: '오 나의 사랑 그대여' };
// layout: 연을 빈칸으로 가른 줄 글자('ABCD EF'), order: 부른 차례('ABCDCDCDEF'). 받아쓰기는 부른 그대로다.
function sungSix(layout, order) {
  const lines = [];
  for (const block of layout.split(' ')) {
    if (lines.length) lines.push('');
    for (const c of block) lines.push(SIX[c]);
  }
  let t = 0;
  const segments = [...order].map((c) => { const d = 2.5 + SIX[c].length * 0.06; const s = seg(SIX[c], t, t + d); t += d + 0.5; return s; });
  return { lyrics: lines.join('\n'), segments, sec: Math.ceil(t + 2), sung: [...order].map((c) => SIX[c]) };
}
const appliedLines = (lyrics, list, picked) => applySuggestions(lyrics, list, picked.map((s) => ({ suggestionId: s.id }))).split('\n').filter((l) => l.trim());

test('a block sung three times but listed once is one high repeat of its two extra copies after the block', () => {
  // 제자리 창이 'C D' 한 벌만 설명해도 남은 'C D'가 같은 블록의 메아리로 붙는다. 창을 옮기면 'A B C D'와 끝말만 같은
  // 받아쓰기 조각이 0.75로 맞아 'A B C D + 함께 노래하자 내일'(조각)을 맨 앞에 넣던 경우다.
  for (const layout of ['ABCD EF', 'ABCDEF']) {
    const { lyrics, segments, sec, sung } = sungSix(layout, 'ABCDCDCDEF');
    const { suggestions } = draft(lyrics, segments, frames(sec, -5));
    assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']], layout);
    assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 3, lines: [SIX.C, SIX.D, SIX.C, SIX.D] }, layout);
    assert.deepEqual(appliedLines(lyrics, suggestions, suggestions), sung, layout);
  }
});

test('a sub-block sung three times inside a stanza is one high repeat placed after its first singing', () => {
  for (const layout of ['ABCD EF', 'ABCDEF']) {
    for (const [order, block] of [['ABCBCBCDEF', 'BC'], ['ABCDBCDBCDEF', 'BCD']]) {
      const { lyrics, segments, sec, sung } = sungSix(layout, order);
      const { suggestions } = draft(lyrics, segments, frames(sec, -5));
      const label = `${layout} ${order}`;
      const highs = suggestions.filter((s) => s.confidence === 'high');
      assert.equal(highs.length, 1, label);
      assert.deepEqual(highs[0].op, { type: 'insertLines', afterLine: block.length, lines: [...block, ...block].map((c) => SIX[c]) }, label);
      assert.deepEqual(appliedLines(lyrics, suggestions, highs), sung, label);
    }
  }
});

test('a chorus sung twice inside a stanza with a once-sung line is one high repeat even when the gap splits a line', () => {
  // 첫 벌 끝 글자를 잘못 듣고('가거나') 둘째 벌에 오타('머리')가 있으면 가사 '라'가 둘째 벌의 '라'와 맞아 갭이 줄 안에서 갈린다.
  // 제자리 창은 'B C' 강함 + 'A' 조각이 되고, 줄마다 확인한 회전으로 창을 옮겨 둘째 벌 전체를 하나의 강함으로 넣는다.
  const A = '바다 멀리 가거라';
  const B = '함께 노래하자 내일이 오니까';
  const C = '저 하늘 끝까지 날아가요';
  const D = '우리 모두 다 같이 손을 잡고';
  for (const layout of ['D-after', 'D-before']) {
    const stanza = layout === 'D-after' ? [A, B, C, D] : [D, A, B, C];
    const lyrics = ['하늘 높이 날아라', '', ...stanza, '', '작은 별이 반짝여요'].join('\n');
    for (const [b1, c2] of [[B, C], ['함께 노래하지 내일이 오니까', '저 하늘 끝까지 날아가유']]) {
      const segments = [seg('하늘 높이 날아라', 0, 3)];
      let t = 4;
      const push = (text, d) => { segments.push(seg(text, t, t + d)); t += d; };
      if (layout === 'D-before') push(D, 4);
      push('바다 멀리 가거나', 3); push(b1, 4); push(C, 3); push('바다 머리 가거라', 3); push(B, 4); push(c2, 3);
      if (layout === 'D-after') push(D, 4);
      t += 1; push('작은 별이 반짝여요', 3);
      const { suggestions } = draft(lyrics, segments, frames(Math.ceil(t + 1), -5));
      const label = `${layout} ${b1}`;
      const highs = suggestions.filter((s) => s.confidence === 'high');
      assert.equal(highs.length, 1, label);
      // 블록이 연의 첫 줄에서 시작하면 빈 줄을 앞에 둔다(D-after).
      const block = layout === 'D-after' ? ['', A, B, C] : [A, B, C];
      assert.deepEqual(highs[0].op, { type: 'insertLines', afterLine: layout === 'D-after' ? 4 : 5, lines: block }, label);
      const want = layout === 'D-after' ? ['하늘 높이 날아라', A, B, C, A, B, C, D, '작은 별이 반짝여요'] : ['하늘 높이 날아라', D, A, B, C, A, B, C, '작은 별이 반짝여요'];
      assert.deepEqual(appliedLines(lyrics, suggestions, highs), want, label);
      wholeLinesOnly(suggestions, lyrics, label);
    }
  }
});

test('a chorus whose first copy has the typos goes after the block with the times of its second copy', () => {
  // 오타가 첫 번째 벌에 있으면 가사 블록이 두 번째 벌과 맞아 삽입이 블록 앞(0행 뒤)에 놓이고 시각이 첫 번째 벌을 가리켰다.
  // 둘째 벌 끝의 군소리 '하'는 다음 줄 첫 글자와 같다.
  const lyrics = ['하늘 높이 날아라', '', '바다 멀리 가거라', '함께 노래하자', '', '하늘 아래 꽃이 피네'].join('\n');
  for (const [a1, b1] of [['바다 머리 가거라', '함께 노래하지'], ['바다 멀리 가거나', '함께 노래하자']]) {
    const segments = [seg('하늘 높이 날아라', 0, 3), seg(a1, 4, 7), seg(b1, 7, 10), seg('바다 멀리 가거라', 11, 14), seg('함께 노래하자 하', 14, 17.5), seg('하늘 아래 꽃이 피네', 18, 21)];
    const { suggestions } = draft(lyrics, segments, frames(22, -5));
    assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']], a1);
    assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 3, lines: ['', '바다 멀리 가거라', '함께 노래하자'] }, a1);
    assert.ok(near(suggestions[0].start, 11) && near(suggestions[0].end, 17), a1);
  }
});

test('a window shift never turns an ad-lib that only shares a line ending into a high repeat', () => {
  // '넌 한 번 한 잔 어때요'는 '너랑 나랑 한잔 어때요'와 끝말만 같다: 줄마다 보면 절반은 덮여도 조각 전체로 짝을 이루지 못한다.
  const lyrics = ['이봐요 이봐요', '너랑 나랑 한잔 어때요', '오늘 밤도 함께해요'].join('\n');
  const segments = [seg('이봐요 이봐요', 0, 3), seg('너랑 나랑 한잔 어때요', 3, 7), seg('어때요', 9, 10), seg('넌 한 번 한 잔 어때요', 20, 24), seg('오늘 밤도 함께해요', 26, 29)];
  const { suggestions } = draft(lyrics, segments, frames(30, -5));
  assert.equal(suggestions.filter((s) => s.confidence === 'high').length, 0);
  assert.deepEqual(suggestions.filter((s) => s.op?.type === 'insertLines').map((s) => [s.kind, s.op.afterLine]), [['new', 1]]);
});

test('a fully sung line with a misheard last syllable never enters a high repeat as a fragment', () => {
  // 셋째 벌 '바다 멀리 가거나'는 구간을 통째로 따로 불렀지만 core가 '가거'에서 끝난다: 조각 '바다 멀리 가거'를 강함에 붙이지 않는다.
  const lyrics = ['하늘 높이 날아라', '바다 멀리 가거라', '', '함께 노래하자 내일이 오니까', '저 하늘 끝까지 날아가요', '', '작은 별이 반짝여요'].join('\n');
  const segments = [];
  let t = 0;
  for (const text of ['하늘 높이 날아나', '바다 머리 가거라', '함께 노래하지 내일이 오니까', '조 하늘 끝까지 날아가요', '바다 멀리 가거요', '함께 노래하지 내일이 오니까', '조 하늘 끝까지 날아가요', '바다 멀리 가거나', '함께 노래하지 내일이 오니까', '조 하늘 끝까지 날아가요', '작은 별이 반짝여유']) {
    segments.push(seg(text, t, t + 3)); t += 3.5;
  }
  const { suggestions } = draft(lyrics, segments, frames(Math.ceil(t + 1), -5));
  wholeLinesOnly(suggestions, lyrics, '끝 글자');
});

test('differences one matching syllable apart are judged as one region', () => {
  // '살/갈'과 '없/있'은 각각 작은 차이지만 사이에 같은 글자 '수' 하나뿐이다: 합치면 '살수없/갈수있'(자모 거리 3).
  const d = draft('그대 없이 살 수 없어', [seg('그대 없이 갈 수 있어', 0, 4)], frames(4, -5));
  assert.equal(d.suggestions.length, 1);
  assert.equal(d.suggestions[0].op.to, '그대 없이 갈 수 있어');
  // 다시 받아쓴 글의 지지도도 합친 구간으로 본다.
  const [req] = d.scoreRequests;
  const kept = finalizeSuggestions(d, { [req.id]: [-20, -15] }, { [req.id]: '그대 없이 갈 수 있어' });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].confidence, 'medium');
});

test('a re-decode that could not be done never leaves a score-only high', () => {
  const strong = (d) => Object.fromEntries(d.scoreRequests.map((r) => [r.id, [-40, -10]]));
  const single = draft(ONE_LINE, oneLineSegs(), frames(6, -5));
  const [sr] = single.scoreRequests;
  // 다시 받아쓰기를 하지 않은 호출(값 없음)은 지금까지처럼 Δ만으로 판정한다.
  assert.equal(finalizeSuggestions(single, strong(single), {})[0].confidence, 'high');
  // 하려다 실패한 요청(null)은 확인되지 않은 것으로 보고 보통까지만 준다.
  const capped = finalizeSuggestions(single, strong(single), { [sr.id]: null });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].confidence, 'medium');
  const remap = draft(
    '하늘 높이 날아라\n푸른 들판 지나서\n\n구름 위로 올라라\n푸른 들판 지나서',
    [seg('하늘 높이 날아라', 0, 3), seg('푸른 들판 지나서', 3, 6), seg('하늘 높이 날아라', 8, 11), seg('푸른 들판 지나서', 11, 14)],
    frames(14, -5),
  );
  const [rr] = remap.scoreRequests;
  assert.equal(finalizeSuggestions(remap, strong(remap), { [rr.id]: null })[0].confidence, 'medium');
});

const sug = (id, op, kind = 'replace') => ({ id, kind, op });
const OVERLAP = /같은 줄을 고치는 제안이 겹칩니다/;

test('applySuggestions inserts, replaces grouped lines and deletes from the bottom up', () => {
  const lyrics = ['첫째 줄', '둘째 줄', '후렴 하나', '후렴 하나', '다섯째 줄', '여섯째 줄'].join('\n');
  const out = applySuggestions(
    lyrics,
    [
      sug('a', { type: 'insertLines', afterLine: 0, lines: ['새 줄 하나', '새 줄 둘'] }, 'new'),
      sug('b', { type: 'replaceLine', lines: [2, 3], from: '후렴 하나', to: '후렴 바꿈' }),
      sug('c', { type: 'deleteLines', from: 4, to: 4 }, 'unheard'),
    ],
    [{ suggestionId: 'a' }, { suggestionId: 'b' }, { suggestionId: 'c' }],
  );
  assert.equal(out, ['첫째 줄', '새 줄 하나', '새 줄 둘', '둘째 줄', '후렴 바꿈', '후렴 바꿈', '여섯째 줄'].join('\n'));
});

test('applySuggestions uses edited text for new lines', () => {
  const s = sug('n', { type: 'insertLines', afterLine: 0, lines: ['원래 줄'] }, 'new');
  const out = applySuggestions('가\n나', [s], [{ suggestionId: 'n', text: '고친 줄 하나\n고친 줄 둘\r\n' }]);
  assert.equal(out, '가\n고친 줄 하나\n고친 줄 둘\n나');
});

test('applySuggestions rejects suggestions without an operation', () => {
  assert.throws(() => applySuggestions('가', [sug('x', null)], [{ suggestionId: 'x' }]), /반영할 수 없는 제안/);
  assert.throws(() => applySuggestions('가', [], [{ suggestionId: 'nope' }]), /반영할 수 없는 제안/);
});

test('applySuggestions refuses overlapping or stale targets', () => {
  const lyrics = '바다 멀리\n하늘 높이\n노을 아래';
  const rep = { type: 'replaceLine', lines: [1], from: '하늘 높이', to: '하늘 낮게' };
  const del = { type: 'deleteLines', from: 1, to: 1 };
  assert.throws(() => applySuggestions(lyrics, [sug('r', rep), sug('d', del)], [{ suggestionId: 'r' }, { suggestionId: 'd' }]), OVERLAP);
  assert.throws(() => applySuggestions(lyrics, [sug('r', rep), sug('r2', { ...rep, to: '다른 줄' })], [{ suggestionId: 'r' }, { suggestionId: 'r2' }]), OVERLAP);
  assert.throws(() => applySuggestions(lyrics, [sug('r', { ...rep, from: '엉뚱한 줄' })], [{ suggestionId: 'r' }]), OVERLAP);
  assert.throws(() => applySuggestions(lyrics, [sug('r', { ...rep, lines: [9] })], [{ suggestionId: 'r' }]), OVERLAP);
  assert.throws(() => applySuggestions(lyrics, [sug('d', { type: 'deleteLines', from: 2, to: 5 })], [{ suggestionId: 'd' }]), OVERLAP);
});

test('applySuggestions fills empty lyrics without blank lines', () => {
  const s = sug('n', { type: 'insertLines', afterLine: -1, lines: ['처음 줄', '다음 줄'] }, 'new');
  assert.equal(applySuggestions('', [s], [{ suggestionId: 'n' }]), '처음 줄\n다음 줄');
});

test('applySuggestions refuses an insert strictly inside a deleted range', () => {
  const lyrics = '가가\n나나\n다다\n라라';
  const ins = sug('i', { type: 'insertLines', afterLine: 0, lines: ['X'] }, 'new');
  const del = sug('d', { type: 'deleteLines', from: 0, to: 2 }, 'unheard');
  assert.throws(() => applySuggestions(lyrics, [ins, del], [{ suggestionId: 'i' }, { suggestionId: 'd' }]), OVERLAP);
  // boundaries are fine: before the range and after its last line
  const before = sug('b', { type: 'insertLines', afterLine: -1, lines: ['X'] }, 'new');
  const after = sug('a', { type: 'insertLines', afterLine: 2, lines: ['Y'] }, 'new');
  assert.equal(applySuggestions(lyrics, [before, after, del], [{ suggestionId: 'b' }, { suggestionId: 'a' }, { suggestionId: 'd' }]), 'X\nY\n라라');
});
