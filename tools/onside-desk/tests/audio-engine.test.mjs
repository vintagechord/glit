import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_PACKAGES,
  ENGINE_VERSION,
  engineStatus,
  findUv,
  installEngine,
  startWorker,
  workerEnv,
} from '../audio-engine.mjs';

const fakeWorker = fileURLToPath(new URL('./fixtures/fake-audio-worker.mjs', import.meta.url));
const fakeCommand = [process.execPath, fakeWorker];

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'audio-engine-'));
}

test('findUv checks PATH then known locations', () => {
  const env = { PATH: '/a/bin:/b/bin', HOME: '/home/x' };
  assert.equal(findUv({ env, exists: (p) => p === '/b/bin/uv' }), '/b/bin/uv');
  assert.equal(findUv({ env, exists: (p) => p === '/opt/homebrew/bin/uv' }), '/opt/homebrew/bin/uv');
  assert.equal(findUv({ env, exists: (p) => p === '/home/x/.cargo/bin/uv' }), '/home/x/.cargo/bin/uv');
  assert.equal(findUv({ env, exists: () => false }), null);
});

test('engineStatus reports missing uv and stale engine versions', async () => {
  const dataRoot = await tmpRoot();
  let status = await engineStatus({ dataRoot, env: { PATH: '' }, exists: () => false });
  assert.deepEqual(
    { installed: status.installed, uv: status.uv, needsUpdate: status.needsUpdate },
    { installed: false, uv: null, needsUpdate: false },
  );
  await fs.mkdir(path.join(dataRoot, '음원분석'), { recursive: true });
  await fs.writeFile(
    path.join(dataRoot, '음원분석', 'engine.json'),
    JSON.stringify({ version: 'audio-check-0', installedAt: '2026-01-01T00:00:00.000Z' }),
  );
  status = await engineStatus({ dataRoot, env: { PATH: '/x' }, exists: (p) => p === '/x/uv' });
  assert.equal(status.installed, true);
  assert.equal(status.version, 'audio-check-0');
  assert.equal(status.uv, '/x/uv');
  assert.equal(status.needsUpdate, true);
  assert.equal(status.installedAt, '2026-01-01T00:00:00.000Z');
});

test('installEngine runs venv, pinned install, warmup in order and writes engine.json', async () => {
  const dataRoot = await tmpRoot();
  const calls = [];
  const events = [];
  const warm = [];
  const info = await installEngine({
    dataRoot,
    uv: '/bin/uv',
    run: async (cmd, args) => { calls.push([cmd, args]); },
    startWorker: ({ command, offline }) => ({
      request: async (c) => { warm.push([command, c, offline]); return {}; },
      close: async () => { events.push('closed'); },
    }),
    onProgress: (m) => events.push(m),
  });
  const venv = path.join(dataRoot, '음원분석', 'venv');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], '/bin/uv');
  assert.deepEqual(calls[0][1], ['venv', '--allow-existing', '--python', '3.12', venv]);
  assert.deepEqual(calls[1][1].slice(0, 4), ['pip', 'install', '--python', path.join(venv, 'bin', 'python')]);
  assert.ok(calls[1][1].includes('mlx-whisper==0.4.3'));
  assert.ok(calls[1][1].includes('demucs==4.1.0'));
  assert.equal(warm[0][1], 'warmup');
  assert.equal(warm[0][0][0], path.join(venv, 'bin', 'python'));
  assert.equal(warm[0][2], false); // 설치 warmup만 모델을 내려받는다
  assert.ok(events.includes('closed'));
  const saved = JSON.parse(await fs.readFile(path.join(dataRoot, '음원분석', 'engine.json'), 'utf8'));
  assert.equal(saved.version, ENGINE_VERSION);
  assert.deepEqual(saved.packages, ENGINE_PACKAGES);
  assert.ok(saved.installedAt);
  assert.deepEqual(info, saved);
});

test('installEngine does not write engine.json when a step fails', async () => {
  const dataRoot = await tmpRoot();
  let n = 0;
  await assert.rejects(
    installEngine({
      dataRoot,
      uv: '/bin/uv',
      run: async () => { n += 1; if (n === 2) throw new Error('pip failed'); },
      startWorker: () => { throw new Error('should not start'); },
    }),
    /pip failed/,
  );
  await assert.rejects(fs.access(path.join(dataRoot, '음원분석', 'engine.json')));
});

test('startWorker correlates responses, streams progress and rejects pending requests when the process dies', async () => {
  const progress = [];
  const worker = startWorker({ command: fakeCommand, onProgress: (e) => progress.push(e) });
  const [a, b] = await Promise.all([worker.request('analyze', { file: 'a.wav' }), worker.request('ping', {})]);
  assert.deepEqual(a, { echoed: 'a.wav' });
  assert.deepEqual(b, { cmd: 'ping' });
  assert.deepEqual(progress.map((p) => p.stage), ['separate', 'transcribe']);
  assert.equal(typeof progress[0].id, 'number');
  await assert.rejects(worker.request('fail', {}), /ValueError: bad input/);
  const pending = worker.request('hang', {});
  const crash = worker.request('crash', {});
  await assert.rejects(pending, /분석 도구가 중단되었습니다\.[\s\S]*fake worker boom/);
  await assert.rejects(crash, /분석 도구가 중단되었습니다\./);
  await assert.rejects(worker.request('analyze', {}), /분석 도구가 중단되었습니다\./);
  await worker.close();
});

test('startWorker runs analysis offline and only the install warmup online', async () => {
  // mlx_whisper는 시작할 때마다 snapshot_download를 부른다: 분석 worker는 HF_HUB_OFFLINE으로 네트워크를 쓰지 않는다.
  assert.equal(workerEnv({ env: { PATH: '/x' } }).HF_HUB_OFFLINE, '1');
  assert.equal(workerEnv({ env: { PATH: '/x' } }).PYTHONUNBUFFERED, '1');
  assert.equal('HF_HUB_OFFLINE' in workerEnv({ offline: false, env: { HF_HUB_OFFLINE: '1' } }), false);
  const analysis = startWorker({ command: fakeCommand });
  assert.deepEqual(await analysis.request('env', {}), { HF_HUB_OFFLINE: '1' });
  await analysis.close();
  const install = startWorker({ command: fakeCommand, offline: false });
  assert.deepEqual(await install.request('env', {}), { HF_HUB_OFFLINE: null });
  await install.close();
});

test('startWorker kills the process on abort', async () => {
  const ac = new AbortController();
  const worker = startWorker({ command: fakeCommand, signal: ac.signal });
  const pending = worker.request('hang', {});
  ac.abort();
  await assert.rejects(pending, /분석 도구가 중단되었습니다\./);
  await worker.close();
});

test('startWorker close ends a healthy worker', async () => {
  const worker = startWorker({ command: fakeCommand });
  await worker.request('ping', {});
  await worker.close();
});

test('startWorker survives an onProgress callback that throws', async () => {
  const worker = startWorker({ command: fakeCommand, onProgress: () => { throw new Error('cb boom'); } });
  assert.deepEqual(await worker.request('analyze', { file: 'a.wav' }), { echoed: 'a.wav' });
  await worker.close();
});

test('installEngine removes a stale engine.json before reinstalling', async () => {
  const dataRoot = await tmpRoot();
  const ej = path.join(dataRoot, '음원분석', 'engine.json');
  await fs.mkdir(path.dirname(ej), { recursive: true });
  await fs.writeFile(ej, JSON.stringify({ version: ENGINE_VERSION, installedAt: 'old' }));
  let n = 0;
  await assert.rejects(
    installEngine({
      dataRoot,
      uv: '/bin/uv',
      run: async () => { n += 1; if (n === 2) throw new Error('pip failed'); },
    }),
    /pip failed/,
  );
  await assert.rejects(fs.access(ej));
  assert.equal((await engineStatus({ dataRoot, env: { PATH: '' }, exists: () => false })).installed, false);
});
