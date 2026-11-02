// Synthetic UI check of registering a manual album as a guest submission.
// No production credentials or customer data are used.
// Run: node tools/onside-desk/tests/ui-manual-online-smoke.mjs [screenshot directory]
import { createDesk } from '../server.mjs';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-manual-online-ui-'));
const screenshots = process.argv[2] || path.join(root, 'screenshots');
await fs.mkdir(screenshots, { recursive: true });
const chromePath = process.env.ONSIDE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const launchOptions = { headless: true };
if (await fs.access(chromePath).then(() => true, () => false)) launchOptions.executablePath = chromePath;

const packageId = '55555555-5555-4555-8555-555555555555';
const submissionId = '66666666-6666-4666-8666-666666666666';
const registered = [];
const remote = {
  configured: () => true,
  health: async () => ({ protocol: 2, capabilities: { guestAlbumIntake: true } }),
  listIntakePackages: async () => ({ packages: [{ id: packageId, name: '13곳 패키지', stationCount: 13, priceKrw: 130000, stations: ['KBS'] }] }),
  registerGuestAlbum: async (payload, { requestId }) => { registered.push(payload); return { submissionId, guestToken: requestId, trackUrl: `https://onside.example/track/${requestId}`, created: true, paid: payload.paid }; },
  getResults: async id => ({
    type: 'ALBUM', revision: 'fixture', submission: { id, type: 'ALBUM', title: '메일 접수 앨범', status: 'PRE_REVIEW', updated_at: '2026-11-02T00:00:00Z' },
    tracks: [{ id: 'track-1', track_no: 1, track_title: '첫 곡' }],
    stations: [{ id: 'station-1', code: 'KBS', name: 'KBS', trackIds: ['track-1'], review: { id: null, status: 'NOT_SENT', track_results: [], result_note: null, updated_at: null } }],
    assets: { items: [] }, notifications: [], notificationWarning: null,
  }),
};
const importer = async () => ({
  submission: { title: '메일 접수 앨범', artist_name: '메일 가수', applicant_name: '홍길동', applicant_phone: '010-0000-0000', applicant_email: 'guest@example.invalid' },
  tracks: [{ track_no: 1, track_title: '첫 곡', lyrics: '가사', is_title: true }], extractedText: '원문', warnings: [],
});
const source = { sourceStatus: () => ({ configured: true }), fetchSubmissions: async () => [], fetchSubmission: async () => { throw Error('offline'); } };
const desk = await createDesk({ dataRoot: root, port: 0, source, remote, importer, reviewer: async () => ({ sourceHash: 'x', findings: [] }), generator: async () => ({ artifacts: [], warnings: [] }), openFolder: () => {}, openUrl: () => {}, timers: false });
const base = `http://127.0.0.1:${desk.server.address().port}`;
const created = await (await fetch(`${base}/api/manual/import?type=ALBUM&filename=${encodeURIComponent('신청서.docx')}`, { method: 'POST', headers: { 'X-Desk-Token': desk.token }, body: 'fixture' })).json();
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(8000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base);
  await page.getByRole('button', { name: /관리자 수동 작업/ }).click();
  await page.locator(`[data-case="${created.id}"]`).click();
  await page.getByRole('heading', { name: '온라인 결과 페이지 만들기' }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '심의 결과' }).count(), 0);
  const form = page.locator('#online-register-form');
  await form.locator('select[name="packageId"] option', { hasText: '13곳 패키지' }).waitFor({ state: 'attached' });
  assert.equal(await form.locator('input[name="guestName"]').inputValue(), '홍길동');
  await form.locator('select[name="packageId"]').selectOption(packageId);
  await page.screenshot({ path: path.join(screenshots, 'manual-online-form.png'), fullPage: true });
  await form.getByRole('button', { name: '비회원 접수로 등록하고 결과 페이지 만들기' }).click();
  assert.match(await page.locator('#confirm-message').innerText(), /13곳 패키지\(방송사 13곳, 130,000원\)/);
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await page.getByRole('heading', { name: '온라인 결과 페이지', exact: true }).waitFor();
  assert.equal(registered.length, 1); assert.equal(registered[0].paid, true);
  assert.match(await page.locator('.online-intake').innerText(), /https:\/\/onside\.example\/track\//);
  await page.screenshot({ path: path.join(screenshots, 'manual-online-linked.png'), fullPage: true });
  await page.getByRole('tab', { name: '심의 결과' }).click();
  await page.getByText('KBS').first().waitFor();
  await page.screenshot({ path: path.join(screenshots, 'manual-online-results.png'), fullPage: true });
  assert.ok(await page.locator('.case-card .badge', { hasText: '결과 페이지 연동' }).count());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots }));
} finally { await browser.close(); await desk.close(); await fs.rm(root, { recursive: true, force: true }).catch(() => {}); }
