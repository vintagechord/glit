import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAudioCheck, progressStageLabel } from '../audio-check-run.mjs';

const LYRICS = '별빛이 내려와요\n우리 함께 걸어요';
const att = (id, name, sha) => ({ id, name, storedName: `${id}.wav`, bytes: 1, createdAt: 'x', sha256: sha });
// worker가 돌려주는 모양: energy는 보컬 스템 자신의 90퍼센타일 기준(10% 이상이 늘 0dB 이상), level은 믹스 90퍼센타일 기준.
const stemEnergy = Array.from({ length: 200 }, (_, k) => (k % 10 < 3 ? 0 : -6));
const sung = Array.from({ length: 200 }, (_, k) => (k % 4 ? -8 : -40));
const silent = Array.from({ length: 200 }, () => -60);

function analysis(over = {}) {
  return {
    duration: 20, separation: 'demucs', residualDb: -30, vocals: '/v.wav', energy: stemEnergy, level: sung,
    segments: [
      { s: 1, e: 5, t: '별빛이 내려와요', words: [] },
      { s: 6, e: 10, t: '우리 함께 걸어요', words: [] },
    ],
    ...over,
  };
}

// redecode: 가사 줄 프롬프트로 다시 받아쓴 글을 돌려주는 함수(던지면 worker 오류). 없으면 글을 돌려주지 않는다.
function fakeWorker(handler = () => analysis(), { redecode, scores = [-10, -5] } = {}) {
  const calls = [];
  return {
    calls,
    count: (cmd) => calls.filter((c) => c.cmd === cmd).length,
    async request(cmd, payload) {
      calls.push({ cmd, payload });
      if (cmd === 'score') return { scores };
      if (cmd === 'redecode') return { text: redecode?.(payload) };
      const result = await handler(payload, calls.filter((c) => c.cmd === 'analyze').length);
      // 실제 worker처럼 분리한 보컬을 outDir/vocals.wav에 쓴다.
      await fs.mkdir(payload.outDir, { recursive: true });
      await fs.writeFile(path.join(payload.outDir, 'vocals.wav'), 'RIFF');
      return result;
    },
  };
}

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'audio-run-'));
}

const t1 = { id: 't1', track_no: 1, track_title: '별빛', lyrics: LYRICS };
const a1 = att('a1', '01 별빛.wav', 'sha-a1');

test('runAudioCheck analyzes each mapped track once, reuses cache on rerun, and scores drafts', async () => {
  const caseDir = await tmp();
  const t2 = { id: 't2', track_no: 2, track_title: '둘', lyrics: LYRICS };
  const a2 = att('a2', '02 둘.wav', 'sha-a2');
  const wrong = analysis({
    segments: [{ s: 1, e: 5, t: '별빛이 내려와요', words: [] }, { s: 6, e: 10, t: '우리 함께 춤을 춰요', words: [] }],
  });
  const worker = fakeWorker(() => wrong);
  const args = { caseDir, tracks: [t1, t2, { id: 't3', track_no: 3, track_title: '셋', lyrics: '' }], attachments: [a1, a2], mapping: { t1: 'a1', t2: 'a2', t3: null }, worker };
  const messages = [];
  const run = await runAudioCheck({ ...args, runId: 'r1', onProgress: (m) => messages.push(m) });
  assert.equal(worker.count('analyze'), 2);
  assert.ok(worker.count('score') >= 2);
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.tracks.map((t) => t.status), ['ok', 'ok', 'skipped']);
  assert.ok(run.tracks[0].suggestions.some((s) => s.kind === 'replace'));
  assert.equal(worker.calls[0].payload.file, path.join(caseDir, '이메일 파일', 'a1.wav'));
  assert.equal(worker.calls[0].payload.language, 'ko');
  assert.ok(messages.includes('1/2 보컬 분리 중 · 01 별빛'));
  assert.ok(messages.includes('1/2 점수 비교 중 · 01 별빛'));
  const full = JSON.parse(await fs.readFile(path.join(caseDir, '음원 대조', 'r1', 'result.json'), 'utf8'));
  assert.equal(full.tracks[0].energy.length, 200);
  assert.ok(Array.isArray(full.tracks[0].transcript));

  const before = worker.count('score');
  await runAudioCheck({ ...args, runId: 'r2' });
  assert.equal(worker.count('analyze'), 2);
  assert.ok(worker.count('score') > before);
  // 캐시가 가리키는 보컬은 캐시 폴더의 vocals.wav다(분석 결과의 옛 경로가 아니라).
  const scored = worker.calls.filter((c) => c.cmd === 'score').at(-1);
  assert.equal(path.basename(scored.payload.vocals), 'vocals.wav');
  assert.ok(scored.payload.vocals.startsWith(path.join(caseDir, '음원 대조 캐시')));
});

test('runAudioCheck re-analyzes a cached track whose vocals.wav is gone', async () => {
  const caseDir = await tmp();
  const worker = fakeWorker();
  const args = { caseDir, tracks: [t1], attachments: [a1], mapping: { t1: 'a1' }, worker };
  await runAudioCheck({ ...args, runId: 'c1' });
  assert.equal(worker.count('analyze'), 1);
  const cacheRoot = path.join(caseDir, '음원 대조 캐시');
  const [key] = await fs.readdir(cacheRoot);
  await fs.rm(path.join(cacheRoot, key, 'vocals.wav'));
  const run = await runAudioCheck({ ...args, runId: 'c2' });
  assert.equal(worker.count('analyze'), 2);
  assert.equal(run.tracks[0].status, 'ok');
  await fs.access(path.join(cacheRoot, key, 'vocals.wav'));
  await runAudioCheck({ ...args, runId: 'c3' });
  assert.equal(worker.count('analyze'), 2);
});

test('runAudioCheck re-decodes every score window with the lyric line as prompt and uses it to judge', async () => {
  const heard = analysis({
    segments: [{ s: 1, e: 5, t: '별빛이 내려와요', words: [] }, { s: 6, e: 10, t: '우리 함께 춤을 춰요', words: [] }],
  });
  const args = { tracks: [t1], attachments: [a1], mapping: { t1: 'a1' } };
  const agree = fakeWorker(() => heard, { redecode: () => '우리 함께 춤을 춰요' });
  const run = await runAudioCheck({ ...args, caseDir: await tmp(), worker: agree });
  const scores = agree.calls.filter((c) => c.cmd === 'score');
  const redecodes = agree.calls.filter((c) => c.cmd === 'redecode');
  assert.ok(scores.length >= 1);
  assert.equal(redecodes.length, scores.length);
  redecodes.forEach((r, k) => {
    const s = scores[k].payload;
    assert.deepEqual(r.payload, { vocals: s.vocals, start: s.start, end: s.end, prompt: s.candidates[0] });
  });
  assert.equal(redecodes[0].payload.prompt, '우리 함께 걸어요');
  const replace = run.tracks[0].suggestions.filter((s) => s.kind === 'replace');
  assert.equal(replace.length, 1);
  assert.equal(replace[0].confidence, 'medium');
  // 다시 받아쓴 글이 가사 줄과 같으면 받아쓰기 착오로 보고 버린다.
  const veto = fakeWorker(() => heard, { redecode: (p) => p.prompt });
  const vetoed = await runAudioCheck({ ...args, caseDir: await tmp(), worker: veto });
  assert.equal(veto.count('redecode'), veto.count('score'));
  assert.deepEqual(vetoed.tracks[0].suggestions.filter((s) => s.kind === 'replace'), []);
});

test('runAudioCheck keeps the track when a re-decode fails but never leaves that replace score-only high', async () => {
  const heard = analysis({
    segments: [{ s: 1, e: 5, t: '별빛이 내려와요', words: [] }, { s: 6, e: 10, t: '우리 함께 춤을 춰요', words: [] }],
  });
  const args = { tracks: [t1], attachments: [a1], mapping: { t1: 'a1' } };
  for (const redecode of [() => { throw new Error('ValueError: 디코딩 실패'); }, () => 42]) {
    const worker = fakeWorker(() => heard, { redecode, scores: [-40, -10] });
    const run = await runAudioCheck({ ...args, caseDir: await tmp(), worker });
    assert.equal(run.tracks[0].status, 'ok');
    assert.equal(worker.count('redecode'), worker.count('score'));
    const replace = run.tracks[0].suggestions.filter((s) => s.kind === 'replace');
    assert.equal(replace.length, 1);
    assert.equal(replace[0].confidence, 'medium');
    assert.equal(replace[0].score, 30);
  }
});

test('runAudioCheck marks a failing track and continues with the rest', async () => {
  const caseDir = await tmp();
  const t2 = { id: 't2', track_no: 2, track_title: '둘', lyrics: LYRICS };
  const a2 = att('a2', '02 둘.wav', 'sha-a2');
  const worker = fakeWorker((p) => {
    if (p.file.endsWith('a1.wav')) throw new Error('디코딩 실패');
    return analysis();
  });
  const run = await runAudioCheck({ caseDir, tracks: [t1, t2], attachments: [a1, a2], mapping: { t1: 'a1', t2: 'a2' }, worker });
  assert.equal(run.status, 'completed');
  assert.equal(run.tracks[0].status, 'failed');
  assert.equal(run.tracks[0].error, '디코딩 실패');
  assert.equal(run.tracks[1].status, 'ok');
  const allFail = await runAudioCheck({ caseDir, tracks: [t1], attachments: [a1], mapping: { t1: 'a1' }, worker: fakeWorker(() => { throw new Error('x'); }) });
  assert.equal(allFail.status, 'failed');
});

test('runAudioCheck rejects when nothing is mapped', async () => {
  const caseDir = await tmp();
  await assert.rejects(
    runAudioCheck({ caseDir, tracks: [t1], attachments: [a1], mapping: { t1: null }, worker: fakeWorker() }),
    /연결된 음원이 없습니다/,
  );
});

test('runAudioCheck pairs MR with its vocal track and checks the MR from the same analysis', async () => {
  const caseDir = await tmp();
  const mr = { id: 'm1', track_no: 2, track_title: '별빛 (MR)', lyrics: '' };
  const am = att('am', '02 별빛 (MR).wav', 'sha-am');
  const worker = fakeWorker((p) => analysis({ separation: 'mr' }));
  const run = await runAudioCheck({ caseDir, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker });
  assert.equal(worker.count('analyze'), 1);
  assert.equal(worker.calls[0].payload.mr, path.join(caseDir, '이메일 파일', 'am.wav'));
  assert.equal(run.tracks[1].status, 'ok');
  assert.deepEqual(run.tracks[1].suggestions, []);

  // subtraction leaves silence (by the mix-relative level; the stem energy stays flat) -> MR flagged, vocal re-analyzed without mr
  const dir2 = await tmp();
  const flat = Array.from({ length: 200 }, (_, k) => (k % 10 === 0 ? 0.5 : -0.5));
  const w2 = fakeWorker((p) => (p.mr ? analysis({ separation: 'mr', energy: flat, level: silent }) : analysis()));
  const run2 = await runAudioCheck({ caseDir: dir2, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker: w2 });
  assert.equal(w2.count('analyze'), 2);
  assert.equal(run2.tracks[1].suggestions[0].kind, 'instrumental');
  assert.equal(run2.tracks[1].suggestions[0].hint, '원곡과 같은 음원일 수 있음');
  assert.equal(run2.tracks[0].separation, 'demucs');

  // subtraction rejected -> MR analyzed on its own, without transcription; its leaked vocals are flagged by level
  const dir3 = await tmp();
  const w3 = fakeWorker((p) => analysis({ separation: 'demucs', level: p.transcribe ? sung : silent }));
  const run3 = await runAudioCheck({ caseDir: dir3, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker: w3 });
  assert.equal(w3.calls.at(-1).payload.transcribe, false);
  assert.equal(run3.tracks[1].status, 'ok');
  assert.deepEqual(run3.tracks[1].suggestions, []);
  const dir4 = await tmp();
  const w4 = fakeWorker(() => analysis({ separation: 'demucs' }));
  const run4 = await runAudioCheck({ caseDir: dir4, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker: w4 });
  assert.equal(run4.tracks[1].suggestions[0].kind, 'instrumental');
});

test('runAudioCheck never calls an MR the same audio or a track vocal-less when the analysis has no level', async () => {
  // level이 없는 분석(예전 형식)은 알 수 없음으로 보고 그런 경고를 내지 않는다.
  const caseDir = await tmp();
  const mr = { id: 'm1', track_no: 2, track_title: '별빛 (MR)', lyrics: '' };
  const am = att('am', '02 별빛 (MR).wav', 'sha-am');
  const old = { ...analysis({ separation: 'mr', energy: silent }) };
  delete old.level;
  const worker = fakeWorker(() => old);
  const run = await runAudioCheck({ caseDir, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker });
  assert.equal(worker.count('analyze'), 1);
  assert.deepEqual(run.tracks[1].suggestions, []);
  assert.ok(!run.tracks[0].suggestions.some((s) => s.kind === 'no-vocal'));
});

test('runAudioCheck stops on abort without writing result.json', async () => {
  const caseDir = await tmp();
  const ac = new AbortController();
  const worker = fakeWorker(() => { ac.abort(); return analysis(); });
  const t2 = { id: 't2', track_no: 2, track_title: '둘', lyrics: LYRICS };
  const a2 = att('a2', '02 둘.wav', 'sha-a2');
  await assert.rejects(
    runAudioCheck({ caseDir, tracks: [t1, t2], attachments: [a1, a2], mapping: { t1: 'a1', t2: 'a2' }, worker, signal: ac.signal, runId: 'ra' }),
    /음원 대조를 중지했습니다/,
  );
  assert.equal(worker.count('analyze'), 1);
  await assert.rejects(fs.access(path.join(caseDir, '음원 대조', 'ra', 'result.json')));
});

test('runAudioCheck uses language null for tracks over 40% latin and marks them foreign', async () => {
  const caseDir = await tmp();
  const en = { id: 'e1', track_no: 1, track_title: 'Star', lyrics: 'shining star in the night\nwe walk together' };
  const worker = fakeWorker();
  const run = await runAudioCheck({ caseDir, tracks: [en], attachments: [a1], mapping: { e1: 'a1' }, worker });
  assert.equal(worker.calls[0].payload.language, null);
  assert.equal(run.tracks[0].foreign, true);
});

test('progressStageLabel maps worker stages', () => {
  assert.equal(progressStageLabel('separate'), '보컬 분리 중');
  assert.equal(progressStageLabel('???'), '분석 중');
});

test('runAudioCheck reads audio from audioDir, honours language auto and drafts a lyric sheet for empty lyrics', async () => {
  const caseDir = await tmp();
  const audioDir = path.join(caseDir, '음원');
  const worker = fakeWorker();
  const blank = { id: 't1', track_no: 1, track_title: '별빛', lyrics: '', language: 'auto' };
  const run = await runAudioCheck({ caseDir, audioDir, tracks: [blank], attachments: [a1], mapping: { t1: 'a1' }, worker, runId: 'r-sheet' });
  const [call] = worker.calls;
  assert.equal(call.payload.file, path.join(audioDir, 'a1.wav'));
  assert.equal(call.payload.language, null);
  assert.equal(worker.count('score'), 0);
  const [track] = run.tracks;
  assert.equal(track.status, 'ok');
  assert.equal(track.foreign, true);
  const sheet = track.suggestions.find((s) => s.kind === 'generated');
  assert.deepEqual(sheet.op, { type: 'insertLines', afterLine: -1, lines: ['별빛이 내려와요', '우리 함께 걸어요'] });
  assert.deepEqual(sheet.times, [[1, 5], [6, 10]]);
});
