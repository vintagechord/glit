import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDesk } from '../server.mjs';
import { customerFilesExpireAt, removeCustomerFiles } from '../customer-file-retention.mjs';

const DAY = 24 * 60 * 60 * 1000;
const id = '44444444-4444-4444-8444-444444444444';
const notifiedAt = '2026-11-01T09:00:00.000Z';
const paid = { payment_status: 'PAID', status: 'RESULT_READY', result_notified_at: notifiedAt };

// Owner decision 2026-11-20: customer files go 7 days after the result notice,
// and an album sent on to 결과 통보 완료 with a station still pending waits
// until every result is in and the final notice is sent.
test('customer files expire 7 days after the result notice of a finished paid review', () => {
  assert.equal(customerFilesExpireAt(paid), '2026-11-08T09:00:00.000Z');
  assert.equal(customerFilesExpireAt({ ...paid, status: 'COMPLETED' }), '2026-11-08T09:00:00.000Z');
});

test('no expiry while the result is not fully notified or the review is not paid', () => {
  assert.equal(customerFilesExpireAt({ ...paid, result_notified_at: null }), null);
  assert.equal(customerFilesExpireAt({ ...paid, status: 'IN_PROGRESS', result_notified_at: null, partial_result_notified_at: notifiedAt }), null);
  assert.equal(customerFilesExpireAt({ ...paid, status: 'IN_PROGRESS' }), null);
  assert.equal(customerFilesExpireAt({ ...paid, payment_status: 'REFUNDED' }), null);
  assert.equal(customerFilesExpireAt({ ...paid, result_notified_at: 'not a date' }), null);
  assert.equal(customerFilesExpireAt(undefined), null);
});

test('removing customer files keeps the receipt note and every generated document', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-retention-'));
  await fs.mkdir(path.join(dir, '원본 파일'));
  await fs.mkdir(path.join(dir, '이메일 파일'));
  await fs.mkdir(path.join(dir, '생성 이력', 'g1'), { recursive: true });
  await fs.writeFile(path.join(dir, '원본 파일', '01_곡.wav'), 'wave');
  await fs.writeFile(path.join(dir, '원본 파일', '파일 수신 현황.txt'), 'note');
  await fs.writeFile(path.join(dir, '이메일 파일', 'abcd1234_메일.mp4'), 'video!');
  await fs.writeFile(path.join(dir, '생성 이력', 'g1', '가사.docx'), 'doc');
  assert.deepEqual(await removeCustomerFiles(dir), { files: 2, bytes: 10 });
  assert.deepEqual(await fs.readdir(path.join(dir, '원본 파일')), ['파일 수신 현황.txt']);
  assert.deepEqual(await fs.readdir(path.join(dir, '이메일 파일')), []);
  assert.deepEqual(await fs.readdir(path.join(dir, '생성 이력', 'g1')), ['가사.docx']);
  assert.deepEqual(await removeCustomerFiles(path.join(dir, 'missing')), { files: 0, bytes: 0 });
});

async function setup(t, { submission: overrides = {}, stored = 'finished', purgeOk = true, purgeDeleted = 1 } = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-retention-desk-'));
  const submission = { id, type: 'MV_DISTRIBUTION', title: '보관 검증', artist_name: '검증 가수', updated_at: '2026-11-01T09:00:00Z', ...paid, ...overrides };
  let fresh = {};
  const source = {
    sourceStatus: () => ({ configured: true, downloadsConfigured: true }),
    fetchSubmissions: async () => [{ ...submission }],
    fetchSubmission: async () => ({ submission: { ...submission, ...fresh }, tracks: [], files: [], assets: [{ id: 'file-1', objectKey: 'submissions/u/mv.mp4', original_name: 'mv.mp4', size: 4, kind: 'VIDEO' }], stations: [], stationReviews: [] }),
    downloadAsset: async (asset, destination) => { await fs.writeFile(destination, 'clip'); return { bytes: 4, sha256: createHash('sha256').update('clip').digest('hex') }; },
  };
  const calls = { list: 0, purge: [] };
  const remote = {
    configured: () => true,
    listStorage: async ({ scope } = {}) => { calls.list++; assert.equal(scope, 'received'); return { items: stored ? [{ submissionId: id, stage: stored, fileCount: 1, totalBytes: 4, files: [{ id: 'file-1', source: 'upload', sizeBytes: 4 }] }] : [] }; },
    purgeStorage: async (ids, options) => { calls.purge.push({ ids, options }); return { ok: purgeOk, results: ids.map(submissionId => purgeOk ? { submissionId, ok: true, deletedFiles: purgeDeleted, failedFiles: 0, freedBytes: 4 * purgeDeleted } : { submissionId, ok: false, deletedFiles: 0, failedFiles: 1, freedBytes: 0, error: '삭제 실패' }) }; },
  };
  // The desk's clock starts at the notice, so setup's own sync finds nothing due.
  let clock = Date.parse(notifiedAt);
  const desk = await createDesk({ dataRoot, port: 0, source, remote, generator: async () => ({ artifacts: [], warnings: [] }), openFolder: () => {}, timers: false, clock: () => clock });
  t.after(async () => { await desk.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });
  await desk.sync(); await desk.idle();
  desk.enqueue(id, 'download'); await desk.idle();
  const caseDir = path.join(desk.outputRoot, id);
  await fs.mkdir(path.join(caseDir, '이메일 파일'), { recursive: true });
  await fs.writeFile(path.join(caseDir, '이메일 파일', 'abcd1234_메일.mp4'), 'mail');
  desk.store.data.cases[id].attachments = [{ id: 'att-1', name: '메일.mp4', storedName: 'abcd1234_메일.mp4', bytes: 4 }];
  await fs.mkdir(path.join(caseDir, '생성 이력', 'g1'), { recursive: true });
  await fs.writeFile(path.join(caseDir, '생성 이력', 'g1', '가사.docx'), 'doc');
  const originals = async () => (await fs.readdir(path.join(caseDir, '원본 파일'))).sort();
  return { desk, calls, caseDir, originals, item: () => desk.store.data.cases[id], setNow: value => { clock = value; }, setFresh: value => { fresh = value; } };
}

const eightDaysLater = Date.parse(notifiedAt) + 8 * DAY;

test('7 days after the notice the desk deletes the service copy and then this Mac\'s customer files', async t => {
  const s = await setup(t);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
  s.setNow(eightDaysLater);
  const result = await s.desk.expireCustomerFiles();
  assert.deepEqual(result.expired, [id]);
  assert.equal(s.calls.purge.length, 1);
  assert.deepEqual(s.calls.purge[0].ids, [id]);
  assert.equal(s.calls.purge[0].options.scope, 'finished');
  assert.deepEqual(await s.originals(), ['파일 수신 현황.txt']);
  assert.deepEqual(await fs.readdir(path.join(s.caseDir, '이메일 파일')), []);
  assert.deepEqual(await fs.readdir(path.join(s.caseDir, '생성 이력', 'g1')), ['가사.docx']);
  assert.ok(s.item().customerFilesExpiredAt);
  assert.deepEqual(s.item().downloads, []);
  assert.deepEqual(s.item().attachments, []);
  assert.ok(s.item().history.some(entry => /서비스 저장소의 고객 업로드 파일 1개/.test(entry.message)));
  assert.ok(s.item().history.some(entry => /이 Mac의 고객 제출 파일 2개/.test(entry.message)));
  // Done once: a later run neither asks the service nor touches the case again.
  s.setNow(eightDaysLater + DAY);
  await s.desk.expireCustomerFiles();
  assert.equal(s.calls.purge.length, 1);
  assert.equal(s.calls.list, 1);
  const detail = await s.desk.detail(id);
  assert.equal(detail.customerFilesExpiredAt, s.item().customerFilesExpiredAt);
  assert.equal(detail.customerFilesExpireAt, '2026-11-08T09:00:00.000Z');
});

test('nothing is deleted before the 7 days are over', async t => {
  const s = await setup(t);
  s.setNow(Date.parse(notifiedAt) + 6 * DAY);
  await s.desk.expireCustomerFiles();
  assert.equal(s.calls.list, 0); assert.equal(s.calls.purge.length, 0);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
  assert.equal(s.item().customerFilesExpiredAt, undefined);
});

test('an album moved on with a station still pending keeps its files', async t => {
  const s = await setup(t, { submission: { type: 'ALBUM', status: 'IN_PROGRESS', result_notified_at: null, partial_result_notified_at: notifiedAt } });
  s.setNow(eightDaysLater);
  await s.desk.expireCustomerFiles();
  assert.equal(s.calls.list, 0); assert.equal(s.calls.purge.length, 0);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
});

test('the service\'s current state decides: a notice the service no longer shows keeps the files', async t => {
  const s = await setup(t);
  // The admin moved it back after this Mac's last look; only a fresh read shows it.
  s.setFresh({ status: 'IN_PROGRESS', result_notified_at: null });
  s.setNow(eightDaysLater);
  const result = await s.desk.expireCustomerFiles();
  assert.deepEqual(result.expired, []);
  assert.equal(s.calls.purge.length, 0);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
});

test('a review the service still holds in review (open supplement, pending station) keeps its files', async t => {
  const s = await setup(t, { stored: 'in_review' });
  s.setNow(eightDaysLater);
  await s.desk.expireCustomerFiles();
  assert.equal(s.calls.purge.length, 0);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
  assert.equal(s.item().customerFilesExpiredAt, undefined);
});

test('when the service copy cannot be deleted, this Mac keeps its files and tries again later', async t => {
  const s = await setup(t, { purgeOk: false });
  s.setNow(eightDaysLater);
  await s.desk.expireCustomerFiles();
  assert.equal(s.calls.purge.length, 1);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
  assert.equal(s.item().customerFilesExpiredAt, undefined);
});

test('a service copy already deleted by hand still lets this Mac delete its files once the service confirms the review is finished', async t => {
  const s = await setup(t, { stored: null, purgeDeleted: 0 });
  s.setNow(eightDaysLater);
  const result = await s.desk.expireCustomerFiles();
  assert.deepEqual(result.expired, [id]);
  // The service is still asked: it alone knows the station results and open supplement requests.
  assert.equal(s.calls.purge.length, 1);
  assert.equal(s.calls.purge[0].options.scope, 'finished');
  assert.deepEqual(await s.originals(), ['파일 수신 현황.txt']);
  assert.ok(!s.item().history.some(entry => /서비스 저장소의 고객 업로드 파일/.test(entry.message)));
});

test('a review the service no longer lists but has not finished (pending station, open supplement) keeps this Mac\'s files', async t => {
  // Before 2026-11-21 a case missing from the service list was deleted here without
  // any check, although its station results or a supplement request were still open.
  const s = await setup(t, { stored: null, purgeOk: false });
  s.setNow(eightDaysLater);
  const result = await s.desk.expireCustomerFiles();
  assert.deepEqual(result.expired, []);
  assert.equal(s.calls.purge.length, 1);
  assert.deepEqual(await s.originals(), ['01_mv.mp4', '파일 수신 현황.txt']);
  assert.deepEqual(await fs.readdir(path.join(s.caseDir, '이메일 파일')), ['abcd1234_메일.mp4']);
  assert.equal(s.item().customerFilesExpiredAt, undefined);
});

test('a sync starts the check, so files go without anyone opening the desk', async t => {
  const s = await setup(t);
  s.setNow(eightDaysLater);
  await s.desk.sync(); await s.desk.idle();
  assert.equal(s.calls.purge.length, 1);
  assert.deepEqual(await s.originals(), ['파일 수신 현황.txt']);
  // The sync-driven check runs at most once an hour.
  s.desk.store.data.cases[id].customerFilesExpiredAt = undefined;
  s.setNow(eightDaysLater + 30 * 60 * 1000);
  await s.desk.sync(); await s.desk.idle();
  assert.equal(s.calls.list, 1);
});
