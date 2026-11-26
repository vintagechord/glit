import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const ENGINE_VERSION = 'audio-check-1';
export const ENGINE_PACKAGES = [
  'mlx-whisper==0.4.3',
  'demucs==4.1.0',
  'torch==2.5.1',
  'torchaudio==2.5.1',
  'numpy==2.5.5',
  'soundfile==0.14.0',
  'imageio-ffmpeg==0.8.1',
];

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEAD_MESSAGE = '분석 도구가 중단되었습니다.';
const STDERR_TAIL = 2048;
const CLOSE_GRACE_MS = 3000;

export function enginePaths(dataRoot) {
  const root = path.join(dataRoot, '음원분석');
  const venv = path.join(root, 'venv');
  return {
    root,
    venv,
    python: path.join(venv, 'bin', 'python'),
    engineJson: path.join(root, 'engine.json'),
    worker: path.join(APP_DIR, 'audio-check', 'worker.py'),
  };
}

export function defaultWorkerCommand(dataRoot) {
  const p = enginePaths(dataRoot);
  return [p.python, p.worker];
}

export function findUv({ env = process.env, exists = fsSync.existsSync } = {}) {
  const home = env.HOME || os.homedir();
  const candidates = [
    ...String(env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'uv')),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv',
    path.join(home, '.local', 'bin', 'uv'),
    path.join(home, '.cargo', 'bin', 'uv'),
  ];
  return candidates.find((c) => exists(c)) || null;
}

export async function engineStatus({ dataRoot, env = process.env, exists = fsSync.existsSync } = {}) {
  const uv = findUv({ env, exists });
  let info = null;
  try {
    info = JSON.parse(await fs.readFile(enginePaths(dataRoot).engineJson, 'utf8'));
  } catch {
    info = null;
  }
  if (!info || typeof info !== 'object') {
    return { installed: false, version: null, uv, needsUpdate: false };
  }
  return {
    installed: true,
    version: info.version ?? null,
    uv,
    installedAt: info.installedAt,
    needsUpdate: info.version !== ENGINE_VERSION,
  };
}

function defaultRun(cmd, args, { signal, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (d) => { tail = (tail + d.toString()).slice(-STDERR_TAIL); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} 실행 실패 (코드 ${code})\n${tail}`));
    });
  });
}

export async function installEngine({
  dataRoot,
  uv,
  run = defaultRun,
  startWorker: start = startWorker,
  onProgress = () => {},
  signal,
} = {}) {
  if (!uv) throw new Error('uv를 찾을 수 없습니다.');
  const p = enginePaths(dataRoot);
  const env = { ...process.env };
  await fs.mkdir(p.root, { recursive: true });

  onProgress('분석 도구 환경을 만드는 중');
  await run(uv, ['venv', '--allow-existing', '--python', '3.12', p.venv], { signal, env });

  await fs.rm(p.engineJson, { force: true });
  onProgress('패키지를 설치하는 중');
  await run(uv, ['pip', 'install', '--python', p.python, ...ENGINE_PACKAGES], { signal, env });

  onProgress('모델을 내려받는 중');
  const worker = start({ command: [p.python, p.worker], signal, offline: false });
  try {
    await worker.request('warmup', {});
  } finally {
    await worker.close();
  }

  const info = { version: ENGINE_VERSION, installedAt: new Date().toISOString(), packages: ENGINE_PACKAGES };
  const tmp = `${p.engineJson}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(info, null, 2)}\n`);
  await fs.rename(tmp, p.engineJson);
  onProgress('설치를 마쳤습니다');
  return info;
}

// 분석용 worker는 네트워크를 쓰지 않는다(offline, 기본값): mlx_whisper가 시작할 때마다 부르는 snapshot_download가
// 내려받은 모델만 쓰게 HF_HUB_OFFLINE을 켠다. 모델을 내려받는 설치 warmup만 offline: false로 띄운다.
export function workerEnv({ offline = true, env = process.env } = {}) {
  const out = { ...env, PYTHONUNBUFFERED: '1' };
  if (offline) out.HF_HUB_OFFLINE = '1';
  else delete out.HF_HUB_OFFLINE;
  return out;
}

export function startWorker({ command, dataRoot, onProgress, signal, offline = true } = {}) {
  const cmd = command || defaultWorkerCommand(dataRoot);
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: workerEnv({ offline }),
  });
  const pending = new Map();
  let nextId = 1;
  let dead = null;
  let stderrTail = '';

  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-STDERR_TAIL); });
  child.stdin.on('error', () => {});

  const fail = (reason) => {
    if (!dead) {
      dead = new Error(`${DEAD_MESSAGE}${reason ? ` ${reason}` : ''}${stderrTail ? `\n${stderrTail}` : ''}`);
    }
    for (const { reject } of pending.values()) reject(dead);
    pending.clear();
  };

  const exited = new Promise((resolve) => {
    child.on('error', (e) => { fail(e.message); resolve(); });
    // close fires after stdio streams end, so stderr is complete here.
    child.on('close', () => { fail(''); resolve(); });
  });

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.event === 'progress') {
      if (onProgress) {
        try { onProgress({ id: msg.id, stage: msg.stage }); } catch { /* callback errors must not crash the worker client */ }
      }
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(String(msg.error || '알 수 없는 오류')));
  });

  const kill = () => { if (child.exitCode === null && !child.killed) child.kill('SIGKILL'); };
  if (signal) {
    if (signal.aborted) kill();
    else signal.addEventListener('abort', kill, { once: true });
  }

  return {
    request(command, payload = {}) {
      if (dead) return Promise.reject(dead);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ ...payload, id, cmd: command })}\n`, (err) => {
          if (err && pending.delete(id)) reject(dead || new Error(`${DEAD_MESSAGE} ${err.message}`));
        });
      });
    },
    async close() {
      try { child.stdin.end(); } catch { /* already closed */ }
      const timer = setTimeout(kill, CLOSE_GRACE_MS);
      await exited;
      clearTimeout(timer);
    },
  };
}
