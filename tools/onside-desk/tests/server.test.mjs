import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createDesk } from '../server.mjs';
import { applyOverrides, validateLocalPatch, childPath } from '../core.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const trackId = '22222222-2222-4222-8222-222222222222';
const localId = 'local-33333333-3333-4333-8333-333333333333';
async function setup(t, options = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-server-test-'));
  let offline = false, downloadCount = 0;
  const submission = { id, type: 'ALBUM', title: '검증 앨범', artist_name: '검증 가수', payment_status: 'PAID', status: 'SUBMITTED', updated_at: '2026-10-25T00:00:00Z' };
  const source = {
    sourceStatus: () => ({ configured: true, downloadsConfigured: true }),
    fetchSubmissions: async () => { if (offline) throw Error('연결 실패'); return [{ ...submission }]; },
    fetchSubmission: async () => { if (offline) throw Error('연결 실패'); return { submission: { ...submission }, tracks: [{ id: trackId, track_no: 1, track_title: '첫 곡', lyrics: '원문' }], files: [], assets: [{ objectKey: 'submissions/test.wav', original_name: '검증.wav', size: 4, kind: 'AUDIO' }], stations: [], stationReviews: [] }; },
    downloadAsset: async (asset, destination) => { downloadCount++; if (options.downloadFail) throw Error('다운로드 실패'); await fs.writeFile(destination, 'wave'); return { bytes: 4, sha256: createHash('sha256').update('wave').digest('hex') }; },
  };
  let generated = 0;
  const generator = async ({ outputDir }) => {
    generated++; await fs.mkdir(path.join(outputDir, '가사'));
    await fs.writeFile(path.join(outputDir, '가사', '01.docx'), 'test-doc');
    return { artifacts: [{ name: '가사/01.docx', type: 'docx', bytes: 8 }], warnings: [] };
  };
  const desk = await createDesk({ dataRoot, port: 0, source, remote: options.remote, generator, openFolder: () => {}, timers: false });
  const url = `http://127.0.0.1:${desk.server.address().port}`;
  const api = (route, init = {}) => fetch(url + route, { ...init, headers: { 'X-Desk-Token': desk.token, 'Content-Type': 'application/json', ...init.headers } });
  t.after(async () => { await desk.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });
  return { desk, api, url, submission, offline: value => { offline = value; }, generated: () => generated, downloads: () => downloadCount };
}
test('loopback API blocks unauthenticated, hostile origins/hosts, inherited IDs and traversal', async t => {
  const { desk, api, url } = await setup(t); await desk.sync();
  assert.equal((await fetch(url + '/api/state')).status, 403);
  assert.equal((await api('/api/sync', { method: 'POST', headers: { Origin: 'https://hostile.test' } })).status, 403);
  const badHost = await new Promise(resolve => http.get(url + '/api/state', { headers: { Host: 'hostile.test', 'X-Desk-Token': desk.token } }, response => { response.resume(); resolve(response.statusCode); }));
  assert.equal(badHost, 403);
  assert.equal((await api('/api/cases/constructor/open', { method: 'POST', body: '{}' })).status, 404);
  assert.throws(() => childPath('/tmp/review', '..', 'secrets'));
  assert.equal((await api('/api/state')).status, 200);
});
test('local edits and added tracks survive remote refresh and offline source changes', async t => {
  const s = await setup(t); await s.desk.sync(); await s.desk.detail(id);
  const patch = { stage: 'PREPARING', notes: '로컬 메모', overrides: { tracks: [{ id: trackId, lyrics: '수정한 가사', performer: '실연자' }, { id: localId, track_no: 2, track_title: '추가 곡', lyrics: '새 가사' }], submission: { wbs_track_numbers: [1, 2] } } };
  assert.equal((await s.api(`/api/cases/${id}/local`, { method: 'PATCH', body: JSON.stringify(patch) })).status, 200);
  s.submission.title = '변경된 앨범'; s.submission.updated_at = '2026-10-25T01:00:00Z';
  await s.desk.sync(); s.offline(true);
  let detail = await s.desk.detail(id);
  assert.equal(detail.tracks.length, 2); assert.equal(detail.tracks[0].lyrics, '수정한 가사'); assert.equal(detail.tracks[0].performer, '실연자');
  assert.equal(detail.local.notes, '로컬 메모'); assert.ok(detail.warnings.some(w => w.includes('마지막으로 저장')));
  s.offline(false); detail = await s.desk.detail(id, true);
  assert.equal(detail.submission.title, '변경된 앨범'); assert.equal(detail.tracks.length, 2);
  assert.throws(() => validateLocalPatch({ overrides: { tracks: [{ id: trackId, _deleted: true }] } }, {}, [trackId]));
});
test('generation deduplicates, keeps nested document history and reports partial media failures', async t => {
  const s = await setup(t, { downloadFail: true }); await s.desk.sync();
  const first = s.desk.enqueue(id, 'generate'); const second = s.desk.enqueue(id, 'generate'); assert.equal(first.id, second.id);
  await s.desk.idle(); assert.equal(s.generated(), 1); assert.equal(first.status, 'failed');
  const generation = s.desk.store.data.cases[id].generations[0];
  assert.ok(generation.artifacts.some(a => a.name === '가사/01.docx'));
  const response = await s.api(`/api/artifacts/${id}/${generation.id}/${encodeURIComponent('가사/01.docx')}`);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'test-doc');
  assert.equal((await s.api(`/api/artifacts/${id}/${generation.id}/${encodeURIComponent('../state.json')}`)).status, 404);
});
test('downloads reuse verified originals, preserve changed files, local uploads and backups omit keys', async t => {
  const s = await setup(t); await s.desk.sync();
  s.desk.enqueue(id, 'download'); await s.desk.idle();
  s.desk.enqueue(id, 'download'); await s.desk.idle(); assert.equal(s.downloads(), 1);
  const name = s.desk.store.data.cases[id].downloads[0].name;
  const original = path.join(s.desk.outputRoot, id, '원본 파일', name); await fs.writeFile(original, 'edit');
  s.desk.enqueue(id, 'download'); await s.desk.idle(); assert.equal(s.downloads(), 2); assert.equal(await fs.readFile(original, 'utf8'), 'edit');
  const upload = await s.api(`/api/cases/${id}/attachments?filename=${encodeURIComponent('../이메일.wav')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'audio' });
  assert.equal(upload.status, 200); const result = await upload.json(); assert.equal(result.attachment.bytes, 5); assert.ok(!result.attachment.name.includes('/'));
  await fs.writeFile(path.join(s.desk.store.root, 'connection.env'), 'SECRET=private');
  const backup = await s.desk.backup(); const { default: PizZip } = await import('pizzip'); const zip = new PizZip(await fs.readFile(backup.path));
  assert.ok(zip.file('state.json')); assert.ok(!Object.keys(zip.files).some(x => x.includes('connection.env') || x.includes('이메일 파일') || x.includes('원본 파일')));
});
test('result bridge preserves service revisions and never writes through local document edits', async t => {
  const calls = [];
  const remote = { configured: () => true, getResults: async caseId => ({ type: 'ALBUM', submission: { id: caseId }, stations: [] }), saveResults: async (caseId, body) => { calls.push([caseId, body]); return { ok: true, changed: true, notification: { deliveredCount: 1 } }; } };
  const s = await setup(t, { remote }); await s.desk.sync();
  assert.equal((await s.api(`/api/cases/${id}/results`)).status, 200);
  await s.api(`/api/cases/${id}/local`, { method: 'PATCH', body: JSON.stringify({ overrides: { submission: { title: '문서 전용 제목' } } }) });
  assert.equal(calls.length, 0);
  const detail = await (await s.api(`/api/cases/${id}`)).json();
  assert.equal(detail.submission.title, '문서 전용 제목'); assert.equal(detail.sourceSubmission.title, '검증 앨범');
  const payload = { operation: 'station', expectedUpdatedAt: null, status: 'SENT', requestId: trackId };
  const result = await s.api(`/api/cases/${id}/results`, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(result.status, 200); assert.deepEqual(calls, [[id, payload]]);
  assert.equal(s.desk.store.data.cases[id].history.filter(row => row.action === 'result').length || s.desk.store.data.cases[id].history.filter(row => row.kind === 'result').length, 1);
});
test('result bridge passes conflicts without success audit and requires local CSRF token', async t => {
  let calls = 0;
  const remote = { configured: () => true, saveResults: async () => { calls++; throw Object.assign(Error('다른 화면에서 수정되었습니다.'), { httpStatus: 409, code: 'CONFLICT' }); } };
  const s = await setup(t, { remote }); await s.desk.sync();
  const route = `/api/cases/${id}/results`;
  assert.equal((await fetch(s.url + route, { method: 'POST', body: '{}' })).status, 403); assert.equal(calls, 0);
  const response = await s.api(route, { method: 'POST', body: '{}' }); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CONFLICT');
  assert.equal(s.desk.store.data.cases[id].history.length, 1);
});
test('certificate bytes and asset downloads stay in authenticated local bridge', async t => {
  let upload;
  const remote = { configured: () => true, uploadCertificate: async (caseId, input) => { upload = input; return { ok: true, changed: false, notification: { pendingAssets: true } }; }, downloadAsset: async () => ({ body: new Response('%PDF-example').body, filename: '필증.pdf', contentType: 'application/pdf', contentLength: 12 }) };
  const s = await setup(t, { remote }); await s.desk.sync();
  const response = await s.api(`/api/cases/${id}/certificate?filename=${encodeURIComponent('필증.pdf')}&expectedUpdatedAt=rev&requestId=${trackId}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-example' });
  assert.equal(response.status, 200); assert.equal(upload.body.toString(), '%PDF-example'); assert.equal(upload.requestId, trackId); assert.equal(upload.expectedUpdatedAt, 'rev');
  const asset = await s.api(`/api/cases/${id}/result-assets/certificate`); assert.equal(asset.status, 200); assert.equal(await asset.text(), '%PDF-example'); assert.equal(asset.headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(s.url + `/api/cases/${id}/result-assets/certificate`)).status, 403);
});
test('email preview requires local authentication and never mutates or queues mail', async t => {
  let previews = 0;
  const preview = { subject: '전체 심의 현황', html: '<p>전체 결과</p>', revision: 'rev', updatedAt: '2026-10-25T01:00:00Z', canSend: true };
  const remote = { configured: () => true, getEmailPreview: async caseId => { assert.equal(caseId, id); previews++; return preview; } };
  const s = await setup(t, { remote }); await s.desk.sync();
  const route = `/api/cases/${id}/email-preview`;
  assert.equal((await fetch(s.url + route)).status, 403); assert.equal(previews, 0);
  assert.deepEqual(await (await s.api(route)).json(), preview); assert.equal(previews, 1);
  assert.equal(s.desk.store.data.cases[id].history.length, 1);
});
