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

test('an omitted chorus whose tail was misheard is still one high repeat of the whole block', () => {
  const segments = edgeSegs([
    seg('오 그대여', 20, 22),
    seg('바다 멀리 가거라 저 하늘 끝까지', 22, 27),
    seg('함께 노래하자 냬닐니 우닛가', 27, 31),
  ]);
  const { suggestions } = draft(EDGE_LYRICS, segments, frames(32, -5));
  assert.deepEqual(suggestions.map((s) => [s.kind, s.confidence]), [['repeat', 'high']]);
  assert.deepEqual(suggestions[0].op, { type: 'insertLines', afterLine: 6, lines: EDGE_BLOCK });
  assert.ok(near(suggestions[0].start, 20) && near(suggestions[0].end, 31));
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
