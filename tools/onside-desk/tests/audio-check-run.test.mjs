import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAudioCheck, progressStageLabel } from '../audio-check-run.mjs';

const LYRICS = '별빛이 내려와요\n우리 함께 걸어요';
const att = (id, name, sha) => ({ id, name, storedName: `${id}.wav`, bytes: 1, createdAt: 'x', sha256: sha });
const loud = Array.from({ length: 200 }, () => -10);
const quiet = Array.from({ length: 200 }, () => -60);

function analysis(over = {}) {
  return {
    duration: 20, separation: 'demucs', residualDb: -30, vocals: '/v.wav', energy: loud,
    segments: [
      { s: 1, e: 5, t: '별빛이 내려와요', words: [] },
      { s: 6, e: 10, t: '우리 함께 걸어요', words: [] },
    ],
    ...over,
  };
}

function fakeWorker(handler = () => analysis()) {
  const calls = [];
  return {
    calls,
    count: (cmd) => calls.filter((c) => c.cmd === cmd).length,
    async request(cmd, payload) {
      calls.push({ cmd, payload });
      if (cmd === 'score') return { scores: [-10, -5] };
      return handler(payload, calls.filter((c) => c.cmd === 'analyze').length);
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
    segments: [{ s: 1, e: 5, t: '별빛이 내려와요', words: [] }, { s: 6, e: 10, t: '우리 함께 걸어서', words: [] }],
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

  // subtraction leaves silence -> MR flagged, vocal re-analyzed without mr
  const dir2 = await tmp();
  const w2 = fakeWorker((p) => (p.mr ? analysis({ separation: 'mr', energy: quiet }) : analysis()));
  const run2 = await runAudioCheck({ caseDir: dir2, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker: w2 });
  assert.equal(w2.count('analyze'), 2);
  assert.equal(run2.tracks[1].suggestions[0].kind, 'instrumental');
  assert.equal(run2.tracks[1].suggestions[0].hint, '원곡과 같은 음원일 수 있음');
  assert.equal(run2.tracks[0].separation, 'demucs');

  // subtraction rejected -> MR analyzed on its own, without transcription
  const dir3 = await tmp();
  const w3 = fakeWorker((p) => analysis({ separation: 'demucs', energy: p.transcribe ? loud : quiet }));
  const run3 = await runAudioCheck({ caseDir: dir3, tracks: [t1, mr], attachments: [a1, am], mapping: { t1: 'a1', m1: 'am' }, worker: w3 });
  assert.equal(w3.calls.at(-1).payload.transcribe, false);
  assert.equal(run3.tracks[1].status, 'ok');
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
