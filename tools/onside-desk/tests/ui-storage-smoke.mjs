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
  // Still in review and not downloaded to this Mac: shown, but cannot be selected.
  { submissionId: '33333333-3333-4333-8333-333333333333', title: '진행 중 뮤직비디오', artistName: '진행 가수', type: 'MV_BROADCAST', refunded: false, stage: 'in_review', finishedAt: null, fileCount: 1, totalBytes: 539 * 1024 ** 2, files: [{ id: 'file-x', source: 'upload', sizeBytes: 539 * 1024 ** 2 }] },
];
const purged = [], cleared = [];
let leftovers = [
  { id: 'a'.repeat(32), reason: 'hidden_upload', name: '_HEDA_HUG_MV_.mp4', submissionId: '44444444-4444-4444-8444-444444444444', submissionTitle: 'HUG', bytes: 539 * 1024 ** 2, versionCount: 2, lastModified: new Date(Date.now() - 6 * day).toISOString() },
  { id: 'b'.repeat(32), reason: 'deleted_submission', name: 'GET_SOMETHING_.mp4', submissionId: '55555555-5555-4555-8555-555555555555', submissionTitle: null, bytes: 0, versionCount: 1, lastModified: new Date(Date.now() - 7 * day).toISOString() },
];
const inventory = () => ({ checkedAt: new Date().toISOString(), truncated: false, totalBytes: 4 * 1024 ** 3, totalVersions: 20, hiddenMarkers: 2, keys: 15,
  groups: [{ key: 'purgeable', count: 3, bytes: 3 * 1024 ** 3 }, { key: 'held', count: 1, bytes: 5 * 1024 ** 2 }, { key: 'leftover', count: leftovers.length, bytes: leftovers.reduce((sum, item) => sum + item.bytes, 0) }, { key: 'certificate', count: 1, bytes: 400_000 }, { key: 'mail_pending', count: 0, bytes: 0 }, { key: 'recent', count: 0, bytes: 0 }, { key: 'other', count: 0, bytes: 0 }],
  held: [{ submissionId: '66666666-6666-4666-8666-666666666666', title: '작성 중 앨범', reason: '작성 중인 신청', count: 1, bytes: 5 * 1024 ** 2 }],
  leftovers });
const remote = {
  configured: () => true,
  health: async () => ({ protocol: 2, capabilities: { storagePurge: true } }),
  listStorage: async ({ inventory: wanted } = {}) => ({ items, inventory: wanted ? inventory() : null }),
  purgeLeftovers: async ids => {
    cleared.push(...ids);
    const results = ids.map(id => ({ id, ok: true, deletedVersions: leftovers.find(item => item.id === id).versionCount, failedVersions: 0, freedBytes: leftovers.find(item => item.id === id).bytes }));
    leftovers = leftovers.filter(item => !ids.includes(item.id));
    return { ok: true, results };
  },
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
  const rows = page.locator('.customer-table tbody tr');
  await rows.nth(2).waitFor();
  assert.equal(await rows.count(), 3);
  assert.equal(await page.locator('#screen img').count(), 0);
  await page.getByRole('button', { name: '결과 후 90일', exact: true }).click();
  assert.equal(await rows.count(), 1);
  await page.getByRole('button', { name: '심의 진행 중', exact: true }).click();
  assert.equal(await rows.count(), 1);
  assert.equal(await page.getByRole('checkbox', { name: '진행 중 뮤직비디오 선택' }).isDisabled(), true);
  await page.getByText('이 Mac에 신청이 없습니다', { exact: false }).waitFor();
  // Not synced to this Mac yet, so there is nothing to download into; the button stays hidden.
  assert.equal(await page.getByRole('button', { name: '원본 받기', exact: true }).count(), 0);
  await page.screenshot({ path: path.join(screenshots, 'storage-in-review.png'), fullPage: true });
  await page.getByRole('button', { name: '전체', exact: true }).click();
  // Select-all takes only the rows that may be deleted.
  await page.getByRole('checkbox', { name: '목록 전체 선택' }).check();
  assert.match(await page.locator('#storage-selection').innerText(), /선택 2건/);
  await page.getByRole('checkbox', { name: '목록 전체 선택' }).uncheck();
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
  assert.equal(await rows.count(), 2);
  await page.screenshot({ path: path.join(screenshots, 'storage-after.png'), fullPage: true });

  // The whole bucket is accounted for, including what no record needs any more.
  await page.getByRole('heading', { name: 'B2 전체 현황' }).waitFor();
  assert.match(await page.locator('.inventory-total').innerText(), /4\.0 GB/);
  await page.getByText('작성 중 앨범', { exact: false }).waitFor();
  const leftoverRows = page.locator('.leftover-table tbody tr');
  assert.equal(await leftoverRows.count(), 2);
  await page.getByText('교체·삭제된 업로드의 숨은 사본').waitFor();
  await page.getByText('숨김 표시만 남아 용량은 없습니다.').waitFor();
  const clearButton = page.getByRole('button', { name: '선택한 남은 파일 영구 삭제' });
  assert.equal(await clearButton.isDisabled(), true);
  await page.getByRole('checkbox', { name: '남은 파일 전체 선택' }).check();
  assert.match(await page.locator('#leftover-selection').innerText(), /선택 2개 · 539\.0 MB/);
  await page.screenshot({ path: path.join(screenshots, 'storage-leftovers.png'), fullPage: true });
  await clearButton.click();
  assert.match(await page.locator('#confirm-message').innerText(), /남은 파일 2개\(539\.0 MB\)/);
  await page.getByRole('button', { name: '2개 영구 삭제', exact: true }).click();
  await page.getByText(/남은 파일 2개 처리 · 버전 3개 삭제 · 539\.0 MB 확보/).waitFor();
  assert.deepEqual(cleared, ['a'.repeat(32), 'b'.repeat(32)]);
  await page.getByText('정리할 남은 파일이 없습니다.').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots }));
} finally { await browser.close(); await desk.close(); await fs.rm(root, { recursive: true, force: true }).catch(() => {}); }
