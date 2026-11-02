// Synthetic UI check of 저장공간 정리. No production credentials or customer data are used.
// Run: node tools/onside-desk/tests/ui-storage-smoke.mjs [screenshot directory]
import { createDesk } from '../server.mjs';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-storage-ui-'));
const screenshots = process.argv[2] || path.join(root, 'screenshots');
await fs.mkdir(screenshots, { recursive: true });
const chromePath = process.env.ONSIDE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const launchOptions = { headless: true };
if (await fs.access(chromePath).then(() => true, () => false)) launchOptions.executablePath = chromePath;

const day = 86_400_000;
let items = [
  { submissionId: '11111111-1111-4111-8111-111111111111', title: '검증 뮤직비디오', artistName: '검증 가수', type: 'MV_DISTRIBUTION', refunded: false, finishedAt: new Date(Date.now() - 2 * day).toISOString(), fileCount: 1, totalBytes: 438_763_634 },
  { submissionId: '22222222-2222-4222-8222-222222222222', title: '<img src=x onerror=alert(1)>', artistName: '환불 가수', type: 'ALBUM', refunded: true, finishedAt: new Date(Date.now() - 120 * day).toISOString(), fileCount: 12, totalBytes: 612 * 1024 ** 2 },
];
const purged = [];
const remote = {
  configured: () => true,
  health: async () => ({ protocol: 2, capabilities: { storagePurge: true } }),
  listStorage: async () => ({ items }),
  purgeStorage: async ids => {
    purged.push(...ids);
    const results = ids.map(submissionId => {
      const item = items.find(entry => entry.submissionId === submissionId);
      return { submissionId, ok: true, deletedFiles: item.fileCount, failedFiles: 0, freedBytes: item.totalBytes };
    });
    items = items.filter(entry => !ids.includes(entry.submissionId));
    return { ok: true, results };
  },
};
const source = { sourceStatus: () => ({ configured: true }), fetchSubmissions: async () => [], fetchSubmission: async () => ({ submission: null, tracks: [], assets: [], files: [] }) };
const desk = await createDesk({ dataRoot: root, port: 0, source, remote, generator: async () => ({ artifacts: [], warnings: [] }), openFolder: () => {}, timers: false });
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${desk.server.address().port}`);
  await page.getByRole('button', { name: /저장공간 정리/ }).click();
  await page.getByRole('heading', { name: '저장공간 정리', exact: true }).waitFor();
  const rows = page.locator('.storage-table tbody tr');
  await rows.nth(1).waitFor();
  assert.equal(await rows.count(), 2);
  assert.equal(await page.locator('#screen img').count(), 0);
  await page.getByRole('button', { name: '90일 경과', exact: true }).click();
  assert.equal(await rows.count(), 1);
  await page.getByRole('button', { name: '전체', exact: true }).click();
  const purgeButton = page.getByRole('button', { name: '선택한 고객 파일 영구 삭제' });
  assert.equal(await purgeButton.isDisabled(), true);
  await page.getByRole('checkbox', { name: '검증 뮤직비디오 선택' }).check();
  assert.match(await page.locator('#storage-selection').innerText(), /선택 1건 · 파일 1개 · 418\.4 MB/);
  await page.screenshot({ path: path.join(screenshots, 'storage-list.png'), fullPage: true });
  await purgeButton.click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  assert.deepEqual(purged, []);
  await purgeButton.click();
  assert.match(await page.locator('#confirm-message').innerText(), /1건의 고객 업로드 파일 1개\(418\.4 MB\)/);
  await page.getByRole('button', { name: '1건 영구 삭제', exact: true }).click();
  await page.getByText(/1건 처리 · 파일 1개 삭제 · 418\.4 MB 확보/).waitFor();
  assert.deepEqual(purged, ['11111111-1111-4111-8111-111111111111']);
  assert.equal(await rows.count(), 1);
  await page.screenshot({ path: path.join(screenshots, 'storage-after.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots }));
} finally { await browser.close(); await desk.close(); await fs.rm(root, { recursive: true, force: true }).catch(() => {}); }
