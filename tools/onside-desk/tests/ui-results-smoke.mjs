// UI-only synthetic endpoint contract test. Does not access production or send mail.
import { createDesk } from '../server.mjs';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-results-ui-'));
const screenshots = path.join(root, 'screenshots'); await fs.mkdir(screenshots);
const albumId = '11111111-1111-4111-8111-111111111111';
const onlineId = '22222222-2222-4222-8222-222222222222';
const broadcastId = '33333333-3333-4333-8333-333333333333';
const submissions = [
  { id: albumId, type: 'ALBUM', title: '우리의 계절이 시작되는 곳', artist_name: '윤서', status: 'IN_PROGRESS', payment_status: 'UNPAID', created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T01:00:00Z' },
  { id: onlineId, type: 'MV_DISTRIBUTION', title: 'Night Drive', artist_name: 'LUNA WAVES', status: 'IN_PROGRESS', payment_status: 'PAID', created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-25T01:00:00Z' },
  { id: broadcastId, type: 'MV_BROADCAST', title: '겨울에 남겨진 편지', artist_name: '차민', status: 'IN_PROGRESS', payment_status: 'PAID', created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-25T01:00:00Z' },
];
const tracks = [1, 2].map(n => ({ id: `track-${n}`, track_no: n, track_title: n === 1 ? '새로운 시작' : '그날의 바람', lyrics: '우리의 이야기' }));
const stationRows = () => ['kbs', 'mbc'].map(code => ({ id: code, code: code.toUpperCase(), name: code === 'kbs' ? 'KBS 한국방송' : 'MBC 문화방송', review: { id: `review-${code}`, status: 'RECEIVED', result_note: '', updated_at: '2026-10-25T02:00:00Z', age_rating: null, track_results: [] } }));
const assets = ready => ({ ready, missing: ready ? [] : ['영등위 발급 필증'], items: [
  { kind: 'ratingImage', label: '등급 표시 이미지', available: true, name: '등급 이미지.png' },
  { kind: 'usageGuide', label: '등급 사용법 예시 PDF', available: true, name: '사용법.pdf' },
  { kind: 'certificate', label: '영등위 발급 필증', available: ready, name: ready ? '공식 필증.pdf' : '' },
] });
const snapshots = new Map(submissions.map(s => [s.id, { type: s.type, revision: s.updated_at, submission: { ...s }, stations: s.type === 'MV_DISTRIBUTION' ? [] : stationRows(), tracks: s.type === 'ALBUM' ? tracks : [], assets: assets(false), canWrite: true }]));
// Production result snapshots omit payment fields and can have newer review status.
for (const snapshot of snapshots.values()) delete snapshot.submission.payment_status;
snapshots.get(albumId).submission.status = 'RESULT_READY';
const source = { sourceStatus: () => ({ configured: true }), fetchSubmissions: async () => submissions, fetchSubmission: async id => ({ submission: submissions.find(s => s.id === id), tracks: id === albumId ? [...tracks, { id: 'local-example', track_no: 3, track_title: '로컬 문서용 곡' }] : [], stationReviews: [], stations: [], files: [], assets: [], warnings: [] }), downloadAsset: async () => ({ bytes: 0 }) };
const desk = await createDesk({ dataRoot: root, port: 0, source, generator: async () => ({ artifacts: [], warnings: [] }), openFolder: () => {}, timers: false }); await desk.sync();
const launchOptions = { headless: true }; const chrome = process.env.ONSIDE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (await fs.access(chrome).then(() => true, () => false)) launchOptions.executablePath = chrome;
const browser = await chromium.launch(launchOptions); const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(7000);
const errors = [], writes = [], certificateWrites = [], emailSends = [], emailPreviews = []; page.on('pageerror', error => errors.push(error.message));
let conflict = false;
await page.route('**/api/cases/*/results', async route => {
  const request = route.request(), id = new URL(request.url()).pathname.split('/')[3], snapshot = snapshots.get(id);
  if (request.method() === 'GET') return route.fulfill({ json: snapshot });
  const body = request.postDataJSON(); writes.push({ id, ...body });
  await new Promise(resolve => setTimeout(resolve, 80));
  if (conflict) { conflict = false; return route.fulfill({ status: 409, json: { code: 'CONFLICT', error: '다른 관리자가 먼저 저장했습니다.' } }); }
  if (body.operation === 'send') {
    if (body.expectedRevision !== snapshot.revision || body.expectedUpdatedAt !== snapshot.submission.updated_at) return route.fulfill({ status: 409, json: { code: 'CONFLICT', error: '미리보기 후 결과가 변경되었습니다.' } });
    emailSends.push(body);
    return route.fulfill({ json: { message: '전체 결과 이메일을 요청했습니다.', notification: id === broadcastId ? { deliveredCount: 0, queuedCount: 0, failedCount: 1, uncertainCount: 1 } : id === onlineId ? { deliveredCount: 0, queuedCount: 1 } : { deliveredCount: 1, queuedCount: 0 } } });
  }
  if (body.operation === 'station') {
    const station = snapshot.stations.find(st => st.id === body.stationId);
    Object.assign(station.review, { status: body.status, result_note: body.resultNote, age_rating: body.ageRating ?? null, track_results: body.trackResults || [], updated_at: '2026-10-25T03:00:00Z' });
  } else if (body.operation === 'bulk-stations') {
    for(const item of body.stations) {const st=snapshot.stations.find(st=>st.id===item.stationId);Object.assign(st.review,{status:body.status,age_rating:body.ageRating??null,updated_at:'2026-10-25T05:00:00Z'});}
  } else if (body.operation === 'online') {
    Object.assign(snapshot.submission, { mv_desired_rating: body.rating, result_memo: body.resultMemo, updated_at: '2026-10-25T03:00:00Z' });
  }
  snapshot.revision = `${snapshot.revision}-updated`;
  await route.fulfill({ json: { message: '서비스에 저장했습니다.', notification: null, snapshot } });
});
await page.route('**/api/cases/*/certificate?**', async route => {
  const url = new URL(route.request().url()), id = url.pathname.split('/')[3]; certificateWrites.push(Object.fromEntries(url.searchParams));
  snapshots.get(id).assets = assets(true); snapshots.get(id).submission.updated_at = '2026-10-25T04:00:00Z';
  await route.fulfill({ json: { message: '필증을 등록했습니다.', notification: null } });
});
await page.route('**/api/cases/*/email-preview', async route => {
  const id = new URL(route.request().url()).pathname.split('/')[3], snapshot = snapshots.get(id); emailPreviews.push(id);
  const canSend = id !== onlineId || snapshot.assets.ready;
  const rows = snapshot.stations.map(st => `<p>${st.code}: ${st.review.status}</p>`).join('');
  const html = `<html lang="ko"><body><h1>온사이드 심의 결과</h1>${rows}<p>${snapshot.submission.mv_desired_rating || ''}</p><a href="https://onside.example/dashboard/submissions/${id}" target="_blank">심의 결과 확인하기</a></body></html>`;
  await route.fulfill({ json: { subject: `[온사이드] ${snapshot.submission.title} 심의 결과 안내`, html, recipientMasked: 'qa***@example.com', revision: snapshot.revision, updatedAt: snapshot.submission.updated_at, canSend, missingAssets: canSend ? [] : ['영등위 발급 필증'] } });
});
try {
  await page.goto(`http://127.0.0.1:${desk.server.address().port}`);
  assert.equal(await page.locator('.nav-item').count(), 4);
  await page.locator('[data-case]').filter({hasText:'우리의 계절이 시작되는 곳'}).click();
  await page.locator('.detail-statuses').getByText('미결제', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '심의 결과', exact: true }).click();
  await page.locator('#station-result-form').waitFor();
  assert.equal(await page.locator('.detail-statuses').getByText('미결제', { exact: true }).count(), 1);
  assert.equal(await page.locator('.detail-statuses').getByText('결과 준비됨', { exact: true }).count(), 1);
  assert.equal(await page.locator('.detail-statuses').getByText('미확인', { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-result-station]').count(), 2);
  assert.deepEqual(await page.locator('#station-result-form [name=status] option').allTextContents(),['접수예정','접수완료','적격','부적격','보완 요청']);assert.equal(await page.locator('#station-result-form [name=status]').inputValue(),'SENT');assert.equal(await page.getByRole('button',{name:'이메일 발송',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'이 내용으로 이메일 발송',exact:true}).count(),1);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(screenshots,'results-overview.png'),fullPage:false});
  assert.equal(await page.locator('.track-result-row').count(), 2);
  assert.equal(await page.locator('#station-result-form').getByText('로컬 문서용 곡').count(), 0);
  await page.locator('#station-result-form [name=status]').selectOption('APPROVED');
  await page.locator('.track-result-details summary').click();
  await page.locator('[name=includeTrackResults]').check();
  await page.locator('[name=trackResult_track-1]').selectOption('APPROVED'); await page.locator('[name=trackResult_track-2]').selectOption('APPROVED');
  await page.locator('[name=resultNote]').fill('방송 적격 확인');
  await page.locator('#station-result-form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await page.waitForTimeout(180);
  assert.equal(emailSends.length, 0);
  assert.equal(writes.length, 1); assert.equal(writes[0].expectedUpdatedAt, '2026-10-25T02:00:00Z'); assert.equal(writes[0].trackResults.length, 2); assert.match(writes[0].requestId, /^[a-f\d-]{36}$/i);
  await page.locator('[data-result-station=mbc]').click(); await page.locator('[name=status]').selectOption('REJECTED'); await page.locator('[name=resultNote]').fill('방송 부적격 확인');
  await page.getByRole('button', { name: '방송사 결과 저장', exact: true }).click(); await page.waitForTimeout(180);
  assert.equal(writes.length, 2); assert.equal(writes[1].applyOverallStatus,true); assert.equal(emailSends.length, 0);
  assert.match(await page.locator('.email-results-summary').innerText(), /KBS[\s\S]*적격[\s\S]*MBC[\s\S]*부적격/);
  await page.getByRole('button', { name: '이메일 발송', exact: true }).click();
  await page.locator('.email-preview-frame').waitFor();
  assert.equal(await page.locator('.email-preview-frame').getAttribute('sandbox'), '');
  assert.match(await page.locator('.email-preview-meta').innerText(), /qa\*\*\*@example.com/);
  const previewFrame = page.frameLocator('.email-preview-frame');
  await previewFrame.getByRole('link', { name: '심의 결과 확인하기' }).waitFor();
  assert.equal(await previewFrame.getByText('KBS: APPROVED', { exact: true }).count(), 1);
  assert.equal(await previewFrame.getByText('MBC: REJECTED', { exact: true }).count(), 1);
  assert.equal(emailSends.length, 0);
  await page.locator('.email-preview').screenshot({ path: path.join(screenshots, 'album-email-preview.png') });
  await page.locator('[data-action=send-email]').evaluate(button => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.getByText('안내 메일을 발송 서버가 접수했습니다.', { exact: false }).first().waitFor();
  assert.equal(emailSends.length, 1); assert.equal(emailSends[0].operation, 'send'); assert.equal(emailSends[0].expectedRevision, snapshots.get(albumId).revision); assert.equal(emailSends[0].expectedUpdatedAt, snapshots.get(albumId).submission.updated_at);
  assert.equal(await page.locator('.email-preview-frame').count(), 0);
  await page.getByRole('button', { name: '전체 결과 이메일 미리보기', exact: true }).click(); await page.locator('.email-preview-frame').waitFor();
  await page.locator('[name=resultNote]').fill('다른 관리자의 변경을 확인할 내 초안');
  assert.equal(await page.locator('.email-preview-frame').count(), 0);
  const previewReads = emailPreviews.length;
  await page.getByRole('button', { name: '전체 결과 이메일 미리보기', exact: true }).click();
  assert.equal(emailPreviews.length, previewReads); assert.equal(await page.locator('[name=resultNote]').inputValue(), '다른 관리자의 변경을 확인할 내 초안');
  conflict = true;
  await page.getByRole('button', { name: '방송사 결과 저장', exact: true }).click();
  await page.locator('#result-conflict').filter({ hasText: '다른 작업에서 결과가 변경' }).waitFor();
  assert.equal(await page.locator('[name=resultNote]').inputValue(), '다른 관리자의 변경을 확인할 내 초안');
  await page.getByRole('button', { name: /서비스 최신 결과 가져오기/ }).click(); await page.getByRole('button', { name: '변경 버리기', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('[name=resultNote]').inputValue(), '방송 부적격 확인');
  await page.getByRole('button', { name: '전체 결과 이메일 미리보기', exact: true }).click(); await page.locator('.email-preview-frame').waitFor();
  snapshots.get(albumId).revision += '-external-change';
  await page.getByRole('button', { name: '이 내용으로 이메일 발송', exact: true }).click();
  await page.locator('#result-conflict').filter({ hasText: '미리보기 이후 결과가 변경되어 이메일을 보내지 않았습니다' }).waitFor();
  assert.equal(emailSends.length, 1); assert.equal(await page.locator('.email-preview-frame').count(), 0);
  await page.getByRole('button', { name: /서비스 최신 결과 가져오기/ }).click(); await page.waitForTimeout(100);
  await page.locator('[data-case]').filter({hasText:'Night Drive'}).click(); await page.getByRole('tab', { name: '심의 결과', exact: true }).click();
  await page.getByText('이메일 첨부는 등급 이미지·사용법 PDF·필증 3종 합계 18MB까지 지원합니다.', { exact: false }).waitFor();
  await page.locator('#online-result-form [name=rating]').selectOption('15'); await page.locator('[name=resultMemo]').fill('영등위 심의 결과 안내');
  await page.getByRole('button', { name: '등급 저장', exact: true }).click(); await page.waitForTimeout(180);
  assert.equal(emailSends.length, 1); assert.equal(await page.locator('.result-assets .file-row').count(), 3);
  await page.getByRole('button', { name: '전체 결과 이메일 미리보기', exact: true }).click(); await page.locator('.email-preview-frame').waitFor();
  assert.equal(await page.getByRole('button', { name: '이 내용으로 이메일 발송', exact: true }).isDisabled(), true);
  await page.locator('#certificate-file').setInputFiles({ name: '공식 필증.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nsynthetic test') });
  assert.equal(await page.locator('.email-preview-frame').count(), 0);
  await page.getByRole('button', { name: '필증 업로드', exact: true }).click(); await page.waitForTimeout(180);
  assert.equal(certificateWrites.length, 1); assert.equal(certificateWrites[0].expectedUpdatedAt, '2026-10-25T03:00:00Z'); assert.match(certificateWrites[0].requestId, /^[a-f\d-]{36}$/i); assert.equal(emailSends.length, 1);
  await page.getByRole('button', { name: '전체 결과 이메일 미리보기', exact: true }).click(); await page.locator('.email-preview-frame').waitFor();
  await page.getByRole('button', { name: '이 내용으로 이메일 발송', exact: true }).click(); await page.getByText('안내 메일이 발송 대기 중이며 자동 재시도됩니다.', { exact: false }).first().waitFor();
  assert.equal(emailSends.length, 2);
  await page.screenshot({ path: path.join(screenshots, 'online-results.png'), fullPage: false });
  await page.locator('[data-case]').filter({hasText:'겨울에 남겨진 편지'}).click(); await page.getByRole('tab', { name: '심의 결과', exact: true }).click();
  assert.equal(await page.locator('.email-preview-frame').count(), 0);
  await page.locator('#station-result-form [name=status]').selectOption('APPROVED'); await page.locator('[name=ageRating]').selectOption('12');
  await page.getByRole('button', { name: '방송사 결과 저장', exact: true }).click(); await page.waitForTimeout(180);
  assert.equal(writes.at(-1).ageRating, '12'); assert.equal(writes.at(-1).stationId, 'kbs'); assert.equal(snapshots.get(broadcastId).stations[1].review.age_rating, null);
  await page.locator('[data-result-station=mbc]').click(); await page.locator('[name=status]').selectOption('REJECTED'); assert.equal(await page.locator('[name=ageRating]').isDisabled(), true);
  await page.getByRole('button', { name: '방송사 결과 저장', exact: true }).click(); await page.waitForTimeout(180); assert.equal(writes.at(-1).ageRating, null); assert.equal(emailSends.length, 2);
  await page.getByRole('button', { name: '전체 결과 이메일 미리보기', exact: true }).click(); await page.locator('.email-preview-frame').waitFor();
  await page.screenshot({ path: path.join(screenshots, 'broadcast-results.png'), fullPage: false });
  await page.getByRole('button', { name: '이 내용으로 이메일 발송', exact: true }).click();
  await page.getByText('접수 여부 확인 필요: 발송 이력을 확인한 뒤 다시 요청해 주세요.', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.notice[role=status]').getByText('안내 메일 발송이 실패했습니다.', { exact: false }).count(), 0);
  assert.equal(emailSends.length, 3);
  await page.locator('#bulk-all').check();assert.equal(await page.locator('[name=bulkStation]:checked').count(),2);await page.locator('[name=bulkStatus]').selectOption('APPROVED');await page.locator('[name=bulkAgeRating]').selectOption('15');assert.equal(await page.locator('#station-result-form [name=status]').isDisabled(),true);await page.getByRole('button',{name:'선택 방송사 일괄 저장',exact:true}).click();await page.waitForTimeout(180);assert.equal(writes.at(-1).operation,'bulk-stations');assert.equal(writes.at(-1).stations.length,2);assert.equal(writes.at(-1).ageRating,'15');assert.ok(writes.at(-1).stations.every(st=>st.expectedUpdatedAt));assert.ok(snapshots.get(broadcastId).stations.every(st=>st.review.status==='APPROVED'&&st.review.age_rating==='15'));assert.equal(emailSends.length,3);assert.equal(await page.locator('[name=bulkStation]:checked').count(),0);
  await page.locator('#bulk-all').check();await page.locator('[name=bulkStatus]').selectOption('SENT');conflict=true;await page.getByRole('button',{name:'선택 방송사 일괄 저장',exact:true}).click();await page.locator('#result-conflict').filter({hasText:'다른 작업에서 결과가 변경'}).waitFor();assert.equal(await page.locator('[name=bulkStation]:checked').count(),2);assert.ok(snapshots.get(broadcastId).stations.every(st=>st.review.status==='APPROVED'));await page.getByRole('button',{name:/서비스 최신 결과 가져오기/}).click();await page.getByRole('button',{name:'변경 버리기',exact:true}).click();await page.waitForTimeout(100);
  await page.locator('[data-case]').filter({hasText:'우리의 계절이 시작되는 곳'}).click();await page.getByRole('tab',{name:'심의 결과',exact:true}).click();await page.locator('#station-result-form [name=status]').selectOption('SENT');assert.ok((await page.locator('[name^=trackResult_]').evaluateAll(items=>items.map(el=>el.value))).every(v=>v==='PENDING'));await page.getByRole('button',{name:'방송사 결과 저장',exact:true}).click();await page.waitForTimeout(180);assert.equal(writes.at(-1).applyOverallStatus,true);assert.equal(writes.at(-1).status,'SENT');assert.equal(await page.locator('#station-result-form [name=status]').inputValue(),'SENT');assert.equal(emailSends.length,3);
  await page.setViewportSize({ width: 940, height: 1000 }); await page.screenshot({ path: path.join(screenshots, 'compact-results.png'), fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, writes: writes.length, certificates: certificateWrites.length, explicitEmailSends: emailSends.length, checks: ['unified navigation', 'lean snapshot retains payment and updates service status', 'combined attachment size guidance', 'requested stations only', 'service tracks only', 'double-submit protection', 'revision + idempotency fields', 'conflict preserves draft', 'explicit discard and refresh', 'online asset readiness', 'certificate upload', 'provider acceptance vs queued status', 'uncertain provider receipt is never called failed', 'multiple saves without mail then one consolidated send', 'sandboxed email preview and customer result CTA', 'draft changes block and invalidate preview', 'stale preview blocks send', 'missing attachments block send', 'broadcast per-station age', 'rejection clears age', 'compact layout','five result options with legacy normalization','prominent email entry and persistent send button','whole-station changes reset visible track decisions','bulk status and age save without mail','bulk conflict preserves selections and data','simultaneous form edits prevented'], screenshots }));
} finally { await browser.close(); await desk.close(); }
