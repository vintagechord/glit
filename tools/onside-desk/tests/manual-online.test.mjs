import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesk } from '../server.mjs';

const packageId = '55555555-5555-4555-8555-555555555555';
const registeredId = '66666666-6666-4666-8666-666666666666';

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-manual-online-'));
  const calls = { register: [], results: [], save: [], opened: [] };
  let serviceSubmissions = [];
  const source = { sourceStatus: () => ({ configured: true }), fetchSubmissions: async () => serviceSubmissions, fetchSubmission: async () => { throw Error('수동 작업은 온라인 조회 금지'); }, downloadAsset: async () => { throw Error('다운로드 금지'); } };
  const remote = {
    configured: () => true,
    listIntakePackages: async () => ({ packages: [{ id: packageId, name: '13곳 패키지', stationCount: 13, priceKrw: 130000, stations: ['KBS'] }] }),
    registerGuestAlbum: async (payload, { requestId }) => {
      calls.register.push({ payload, requestId });
      if (options.failFirst && calls.register.length === 1) throw Object.assign(new Error('온사이드 응답 시간이 초과되었습니다.'), { status: 504 });
      return { submissionId: registeredId, guestToken: requestId, trackUrl: `https://onside.example/track/${requestId}`, created: true, paid: payload.paid };
    },
    getResults: async id => { calls.results.push(id); return { submission: { id, updated_at: '2026-11-02T00:00:00Z' }, stations: [], assets: { items: [{ kind: 'certificate', downloadUrl: `/api/cases/${id}/result-assets/certificate` }] } }; },
    saveResults: async (id, body) => { calls.save.push({ id, body }); return { ok: true, changed: true }; },
  };
  const importer = async () => ({
    submission: { title: '메일 접수 앨범', artist_name: '메일 가수', artist_type: '그룹', release_date: '2026년 11월 5일', applicant_name: '홍길동', applicant_phone: '010-0000-0000', applicant_email: 'guest@example.invalid', members: '가, 나' },
    tracks: [{ track_no: 1, track_title: '첫 곡', lyrics: '가사', is_title: true }, { track_no: 2, track_title: '둘째 곡', lyrics: '가사 둘' }, { track_no: 3, track_title: '' }],
    extractedText: '원문', warnings: [],
  });
  const reviewer = async () => ({ sourceHash: 'fixture', findings: [] });
  const desk = await createDesk({ dataRoot: root, port: 0, source, remote, importer, reviewer, generator: async () => ({ artifacts: [], warnings: [] }), openFolder: () => {}, openUrl: link => calls.opened.push(link), timers: false });
  const url = `http://127.0.0.1:${desk.server.address().port}`;
  const api = (route, init = {}) => fetch(url + route, { ...init, headers: { 'X-Desk-Token': desk.token, 'Content-Type': 'application/json', ...init.headers } });
  const create = async (type = 'ALBUM') => { const response = await api(`/api/manual/import?type=${type}&filename=${encodeURIComponent('신청서.docx')}`, { method: 'POST', body: 'fixture' }); assert.equal(response.status, 201); return response.json(); };
  t.after(async () => { await desk.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { desk, api, create, calls, setService: list => { serviceSubmissions = list; } };
}
const register = (s, id, body = {}) => s.api(`/api/cases/${id}/register-online`, { method: 'POST', body: JSON.stringify({ packageId, paid: true, guestName: '홍길동', guestPhone: '010-0000-0000', guestEmail: 'guest@example.invalid', ...body }) });

test('a manual album registers as a guest submission and then saves results through it', async t => {
  const s = await setup(t);
  const { id } = await s.create();
  assert.equal((await (await s.api('/api/intake/packages')).json()).packages[0].id, packageId);
  assert.equal((await s.api(`/api/cases/${id}/results`)).status, 409);
  assert.equal((await register(s, id, { guestName: '' })).status, 400);
  assert.equal((await register(s, id, { guestEmail: 'not-an-email' })).status, 400);
  assert.equal(s.calls.register.length, 0);
  const response = await register(s, id);
  assert.equal(response.status, 200);
  const { online, detail } = await response.json();
  assert.equal(online.submissionId, registeredId); assert.equal(detail.online.trackUrl, `https://onside.example/track/${online.guestToken}`);
  const { payload } = s.calls.register[0];
  assert.deepEqual(payload.guest, { name: '홍길동', phone: '010-0000-0000', email: 'guest@example.invalid' });
  assert.equal(payload.submission.releaseDate, '2026-11-05'); assert.equal(payload.submission.artistType, 'GROUP'); assert.equal(payload.submission.artistMembers, '가, 나');
  assert.deepEqual(payload.tracks.map(track => [track.trackTitle, track.isTitle]), [['첫 곡', true], ['둘째 곡', false]]);
  // Results and saves go to the registered service submission; asset links stay on the local case.
  const results = await (await s.api(`/api/cases/${id}/results`)).json();
  assert.deepEqual(s.calls.results, [registeredId]); assert.equal(results.assets.items[0].downloadUrl, `/api/cases/${id}/result-assets/certificate`);
  assert.equal((await s.api(`/api/cases/${id}/results`, { method: 'POST', body: JSON.stringify({ operation: 'station' }) })).status, 200);
  assert.equal(s.calls.save[0].id, registeredId);
  assert.equal((await s.api(`/api/cases/${id}/open-online`, { method: 'POST', body: '{}' })).status, 200);
  assert.deepEqual(s.calls.opened, [online.trackUrl]);
  // Registering again returns the stored link without another service call.
  assert.equal((await (await register(s, id)).json()).online.guestToken, online.guestToken); assert.equal(s.calls.register.length, 1);
  // Sync keeps the service copy on the manual case instead of adding a duplicate online case.
  s.setService([{ id: registeredId, type: 'ALBUM', title: '메일 접수 앨범', status: 'IN_PROGRESS', payment_status: 'PAID', updated_at: '2026-11-03T00:00:00Z' }]);
  await s.desk.sync();
  const state = s.desk.publicState();
  assert.equal(state.cases.length, 1); assert.equal(state.cases[0].online, true);
  assert.equal((await s.desk.detail(id)).online.status, 'IN_PROGRESS');
});

test('a retried registration reuses the same lookup code after a lost response', async t => {
  const s = await setup(t, { failFirst: true });
  const { id } = await s.create();
  assert.equal((await register(s, id)).status, 504);
  assert.equal((await register(s, id)).status, 200);
  assert.equal(s.calls.register.length, 2);
  assert.equal(s.calls.register[0].requestId, s.calls.register[1].requestId);
});

test('only manual album cases can be registered online', async t => {
  const s = await setup(t);
  const { id } = await s.create('MV_BROADCAST');
  const response = await register(s, id);
  assert.equal(response.status, 400); assert.match((await response.json()).error, /음반 수동 작업만/);
  assert.equal(s.calls.register.length, 0);
});
