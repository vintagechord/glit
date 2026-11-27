// 음원 가사 대조 (left menu) end to end: a real desk server with a fake analysis engine, driven in Chrome.
// Made-up lyrics only. Usage: node tools/onside-desk/tests/ui-audio-session-smoke.mjs [screenshot dir]
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { createDesk } from '../server.mjs';
import { lyricsHash } from '../audio-check.mjs';

const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) await fs.mkdir(shots, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-audio-ui-'));
const SECOND = '작은 별이 반짝여\n밤하늘을 건너가';
const until = async (check, timeout = 5000) => { const end = Date.now() + timeout; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 50)); } };

function run({ tracks, mapping }) {
  return { id: randomUUID(), status: 'completed', createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(), engineVersion: 'audio-check-1',
    tracks: tracks.map(t => {
      const base = { trackId: t.id, attachmentId: mapping[t.id], lyricsHash: lyricsHash(t.lyrics ?? ''), separation: 'demucs', duration: 30, foreign: false, status: 'ok', applied: [] };
      if (!mapping[t.id]) return { ...base, attachmentId: null, status: 'skipped', suggestions: [] };
      if (!t.lyrics) return { ...base, suggestions: [
        { id: `${t.id}:generated::a`, trackId: t.id, kind: 'generated', confidence: 'check', start: 1, end: 20, op: { type: 'insertLines', afterLine: -1, lines: ['하늘 위로 걸어가', '구름 사이 노래해', '', '바람 따라 춤을 춰'] }, hint: '', score: null, lines: [], times: [[1, 4], [4, 7], null, [15, 20]] },
        { id: `${t.id}:unclear::b`, trackId: t.id, kind: 'unclear', confidence: 'check', start: 22, end: 26, op: null, hint: '', score: null, lines: [] },
      ] };
      return { ...base, suggestions: [
        { id: `${t.id}:repeat:1:c`, trackId: t.id, kind: 'repeat', confidence: 'high', start: 12, end: 18, op: { type: 'insertLines', afterLine: 1, lines: ['', '작은 별이 반짝여', '밤하늘을 건너가'] }, hint: '', score: null, lines: [] },
      ] };
    }) };
}

const desk = await createDesk({
  dataRoot: root, port: 0, timers: false, openFolder: () => {},
  source: { sourceStatus: () => ({ configured: false }), fetchSubmissions: async () => [], fetchSubmission: async () => { throw new Error('no'); }, downloadAsset: async () => { throw new Error('no'); } },
  remote: { configured: () => false },
  generator: async () => ({ artifacts: [], warnings: [] }), translator: async () => ({ overrides: {}, translatedCount: 0, warnings: [] }),
  reviewer: async () => ({ sourceHash: 'x', findings: [], requiresReview: false, counts: { total: 0 } }),
  audio: {
    engineStatus: async () => ({ installed: true, version: 'audio-check-1', uv: '/fake/uv', needsUpdate: false }),
    startWorker: () => ({ async request() { return {}; }, async close() {} }),
    runAudioCheck: async input => { await new Promise(resolve => setTimeout(resolve, 600)); return run(input); },
  },
});
const base = `http://127.0.0.1:${desk.server.address().port}`;
const options = { headless: true }; const chrome = process.env.ONSIDE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (await fs.access(chrome).then(() => true, () => false)) options.executablePath = chrome;
const browser = await chromium.launch(options);
const errors = [];
try {
  for (const width of [1440, 760]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole('button', { name: /음원 가사 대조/ }).click();
    await page.getByRole('heading', { level: 1, name: '음원 가사 대조' }).waitFor();
    await page.getByText('분석 도구 준비됨').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, `1-empty-${width}.png`), fullPage: true });
    if (width !== 1440) { await context.close(); continue; }

    // Drop two files through the picker: a session is created and each file becomes a track.
    await page.locator('[data-audio-files="new"]').setInputFiles([
      { name: '01_하늘 노래.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF fixture one') },
      { name: '02 별 노래.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3 fixture two') },
      { name: '안내.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') },
    ]);
    await page.locator('.audio-track-card').nth(1).waitFor();
    assert.deepEqual(await page.locator('.audio-track-title').evaluateAll(els => els.map(el => el.value)), ['하늘 노래', '별 노래']);
    assert.deepEqual(await page.locator('.audio-mode').allTextContents(), ['가사지 생성', '가사지 생성']);
    await page.locator('.audio-lyrics').nth(1).fill(SECOND);
    assert.equal(await page.locator('.audio-mode').nth(1).textContent(), '가사 대조');
    await page.locator('[data-session-field="artist"]').fill('지어낸 가수');
    const id = Object.keys(desk.store.data.audioSessions)[0];
    await until(() => desk.store.data.audioSessions[id].artist === '지어낸 가수' && desk.store.data.audioSessions[id].tracks[1].lyrics === SECOND);
    await page.getByText('저장됨').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '2-session-tracks-1440.png'), fullPage: true });

    await page.getByRole('button', { name: '분석 시작' }).click();
    await page.getByRole('button', { name: '중지' }).waitFor();
    await page.getByText('분석 결과').waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('button', { name: /선택한 제안 반영 \(2개\)/ }).isEnabled(), true);
    await page.locator('.audio-sheet-text').fill('하늘 위로 걸어가\n구름 사이 노래해\n\n바람 따라 춤을 춰요');
    if (shots) await page.screenshot({ path: path.join(shots, '3-results-1440.png'), fullPage: true });
    await page.getByRole('button', { name: /선택한 제안 반영/ }).click();
    await page.getByText(/제안 2개를 가사에 반영했습니다/).waitFor();
    assert.deepEqual(await page.locator('.audio-lyrics').evaluateAll(els => els.map(el => el.value)), ['하늘 위로 걸어가\n구름 사이 노래해\n\n바람 따라 춤을 춰요', `${SECOND}\n\n${SECOND}`]);
    assert.deepEqual(await page.locator('.audio-mode').allTextContents(), ['가사 대조', '가사 대조']);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '가사지 Word 저장' }).click();
    const file = await (await download).path();
    const xml = new PizZip(await fs.readFile(file)).file('word/document.xml').asText().replace(/<[^>]+>/g, '');
    assert.match(xml, /지어낸 가수 - /);
    assert.match(xml, /바람 따라 춤을 춰요/);

    // The left list shows the session; deleting it asks first and clears the folder.
    assert.match(await page.locator('#audio-session-list').textContent(), /2곡 · 음원 2개/);
    await page.getByRole('button', { name: '빼기' }).first().click();
    await page.getByRole('button', { name: '빼기', exact: true }).last().click();
    await page.locator('.audio-track-card').nth(1).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '작업 삭제' }).click();
    await page.locator('#confirm-dialog').getByRole('button', { name: '삭제' }).click();
    await page.getByText('대조 작업을 삭제했습니다.').waitFor();
    assert.deepEqual(desk.store.data.audioSessions, {});
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, shots }));
} finally {
  await browser.close(); await desk.close(); await fs.rm(root, { recursive: true, force: true });
}
