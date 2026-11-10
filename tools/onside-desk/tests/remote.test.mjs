import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteReviewClient, RemoteReviewError, signRemoteReviewRequest } from '../remote.mjs';
import * as sharedAuth from '../../../src/lib/admin/review-desk-auth.ts';
const { verifyDeskRequest, signDeskRequest } = sharedAuth.default || sharedAuth;

const actor = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const nonce = '33333333-3333-4333-8333-333333333333';
const now = 1792886400000;
const secret = 'test-only-private-key-never-in-a-request';
const env = { ONSIDE_DESK_SERVICE_URL: 'https://onside.example', ONSIDE_DESK_ADMIN_USER_ID: actor, SUPABASE_SERVICE_ROLE_KEY: secret };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const snapshot = { type: 'MV_DISTRIBUTION', submission: { id, updated_at: '2026-10-25T01:00:00Z' }, stations: [], tracks: [] };
function mockClient(handler, overrides = {}) {
  const calls = [];
  const client = createRemoteReviewClient({ ...env, ...overrides }, { now: () => now, fetchImpl: async (url, init) => { calls.push({ url, init }); return handler(url, init); } });
  return { client, calls };
}
function verifyCall(url, init) {
  const body = init.body || Buffer.alloc(0);
  const request = new Request(url, { method: init.method, headers: init.headers, ...(init.method === 'GET' ? {} : { body }) });
  assert.deepEqual(verifyDeskRequest(request, body, secret, now), { actorId: actor, requestId: init.headers['x-onside-desk-request'] });
  assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
  assert.ok(!url.includes(secret)); assert.ok(!JSON.stringify(init.headers).includes(secret));
  assert.equal(new Headers(init.headers).get('authorization'), null); assert.equal(new Headers(init.headers).get('apikey'), null);
}

test('remote configuration accepts an HTTPS origin and explicit test-only localhost', async () => {
  assert.equal(createRemoteReviewClient(env).configured(), true);
  for (const origin of ['http://onside.example', 'https://user:pass@onside.example', 'https://onside.example/path', 'https://onside.example?key=bad', 'https://onside.example#hash', 'file:///tmp/test', 'http://localhost:3210']) {
    const client = createRemoteReviewClient({ ...env, ONSIDE_DESK_SERVICE_URL: origin });
    assert.equal(client.configured(), false, origin);
    await assert.rejects(client.health(), error => error.httpStatus === 503 && error.code === 'DESK_NOT_CONFIGURED');
  }
  assert.equal(createRemoteReviewClient({ ...env, ONSIDE_DESK_SERVICE_URL: 'http://localhost:3210' }, { allowInsecureLocalhost: true }).configured(), true);
  assert.equal(createRemoteReviewClient({ ...env, ONSIDE_DESK_SERVICE_URL: 'http://external.example' }, { allowInsecureLocalhost: true }).configured(), false);
  assert.equal(createRemoteReviewClient({ ...env, ONSIDE_DESK_ADMIN_USER_ID: 'not-an-admin-id' }).configured(), false);
  assert.equal(createRemoteReviewClient({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }).configured(), false);
});

test('Mac signature matches shared service signature and actual verifier for raw UTF-8 bytes', () => {
  const input = { method: 'post', path: `/api/internal/review-desk/${id}?action=certificate&filename=%ED%95%84%EC%A6%9D.pdf`, timestamp: String(now), requestId: nonce, actorId: actor, body: Buffer.from('등급 15세\n%PDF-1.7') };
  assert.equal(signRemoteReviewRequest(secret, input), signDeskRequest(secret, input));
  assert.notEqual(signRemoteReviewRequest(secret, input), signRemoteReviewRequest(secret, { ...input, body: Buffer.from('different') }));
  assert.notEqual(signRemoteReviewRequest(secret, input), signRemoteReviewRequest(secret, { ...input, path: input.path + '&changed=1' }));
});

test('health is signed and refuses incompatible service deployments', async () => {
  const { client, calls } = mockClient((url, init) => { verifyCall(url, init); assert.equal(new URL(url).pathname, '/api/internal/review-desk/health'); return json({ protocol: 2, connected: true }); });
  assert.equal((await client.health()).connected, true); assert.equal(calls.length, 1);
  await assert.rejects(mockClient(() => json({ protocol: 1 })).client.health(), error => error.code === 'DESK_PROTOCOL_MISMATCH');
});

test('snapshot asset links are authenticated local routes and unavailable links are removed', async () => {
  const { client } = mockClient((url, init) => { verifyCall(url, init); return json({ ...snapshot, assets: { items: [{ kind: 'ratingImage', available: true, downloadUrl: 'https://private.example/secret' }, { kind: 'certificate', available: false, downloadUrl: 'https://private.example/secret' }] } }); });
  const data = await client.getResults(id);
  assert.equal(data.assets.items[0].downloadUrl, `/api/cases/${id}/result-assets/ratingImage`);
  assert.equal(data.assets.items[1].downloadUrl, undefined);
  assert.ok(!JSON.stringify(data).includes('private.example'));
  await assert.rejects(mockClient(() => json({ ...snapshot, assets: { items: {} } })).client.getResults(id), error => error.code === 'INVALID_RESULT_SNAPSHOT');
  await assert.rejects(mockClient(() => json({ invalid: true })).client.getResults(id), error => error.code === 'INVALID_RESULT_SNAPSHOT');
});

test('station save preserves revision and idempotency ID without retrying conflicts', async () => {
  const payload = { operation: 'station', stationId: actor, expectedUpdatedAt: '2026-10-25T01:00:00Z', status: 'APPROVED', ageRating: '15', requestId: nonce };
  const { client, calls } = mockClient((url, init) => { verifyCall(url, init); assert.deepEqual(JSON.parse(init.body), payload); assert.equal(init.headers['x-onside-desk-request'], nonce); return json({ error: '다른 관리자가 변경했습니다.', errorCode: 'CONFLICT' }, 409); });
  await assert.rejects(client.saveResults(id, payload), error => error instanceof RemoteReviewError && error.httpStatus === 409 && error.status === 409 && error.code === 'CONFLICT');
  assert.equal(calls.length, 1);
});
test('email preview is a signed read and explicit send carries its exact revision', async () => {
  const preview = { subject: '[onside] 전체 심의 현황', html: '<p>현황 보기</p>', recipientMasked: 'a***@example.test', revision: 'preview-revision', updatedAt: '2026-10-25T01:00:00Z', canSend: true };
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init);
    if (init.method === 'GET') { assert.equal(new URL(url).searchParams.get('preview'), 'email'); return json(preview); }
    const body = JSON.parse(init.body); assert.equal(body.operation, 'send'); assert.equal(body.expectedRevision, preview.revision); assert.equal(body.requestId, nonce);
    return json({ ok: true, changed: false, notification: { deliveredCount: 1 } });
  });
  assert.deepEqual(await client.getEmailPreview(id), preview); assert.equal(calls.length, 1);
  await client.saveResults(id, { operation: 'send', expectedRevision: preview.revision, expectedUpdatedAt: preview.updatedAt, requestId: nonce }); assert.equal(calls.length, 2);
  await assert.rejects(mockClient(() => json({ html: 'invalid' })).client.getEmailPreview(id), error => error.code === 'INVALID_EMAIL_PREVIEW');
});

test('bulk station saves preserve all optimistic revisions in one signed request',async()=>{
  const payload={operation:'bulk-stations',stations:[{stationId:actor,reviewId:null,expectedUpdatedAt:null}],status:'SENT',requestId:nonce};
  const {client,calls}=mockClient((url,init)=>{verifyCall(url,init);assert.deepEqual(JSON.parse(init.body),payload);return json({ok:true,changed:true,notification:null,snapshot});});
  assert.equal((await client.saveResults(id,payload)).changed,true);assert.equal(calls.length,1);
});

test('online and resend save generate one UUID shared by signed header and JSON', async () => {
  const { client, calls } = mockClient((url, init) => { verifyCall(url, init); const payload = JSON.parse(init.body); assert.equal(payload.requestId, init.headers['x-onside-desk-request']); return json({ ok: true, notification: { queuedCount: 1 } }); });
  assert.equal((await client.saveResults(id, { operation: 'online', rating: '12', expectedUpdatedAt: 'rev' })).notification.queuedCount, 1);
  await client.saveResults(id, { operation: 'resend', expectedUpdatedAt: 'rev', requestId: nonce });
  assert.equal(calls.length, 2); assert.equal(JSON.parse(calls[1].init.body).expectedUpdatedAt, 'rev');
  await assert.rejects(client.saveResults(id, { operation: 'delete' }), error => error.code === 'INVALID_OPERATION');
  await assert.rejects(client.saveResults(id, { operation: 'online', requestId: 'invalid' }), error => error.code === 'INVALID_REQUEST_ID');
  await assert.rejects(client.saveResults('../outside', { operation: 'online' }), error => error.code === 'INVALID_SUBMISSION_ID');
  await assert.rejects(client.saveResults(id, { operation: 'online', resultMemo: 'a'.repeat(3 * 1024 * 1024) }), error => error.httpStatus === 413);
  assert.equal(calls.length, 2);
});

test('certificate upload signs identical raw bytes, encoded filename and revision', async () => {
  const original = Buffer.from('%PDF-1.7\n필증 데이터');
  const { client, calls } = mockClient((url, init) => { verifyCall(url, init); const parsed = new URL(url); assert.equal(parsed.searchParams.get('filename'), '_필증 이름.pdf'); assert.equal(parsed.searchParams.get('expectedUpdatedAt'), '2026-10-25T01:00:00+09:00'); assert.equal(parsed.searchParams.get('requestId'), nonce); assert.equal(parsed.searchParams.get('action'), 'certificate'); assert.equal(init.headers['Content-Type'], 'application/pdf'); assert.deepEqual(init.body, original); return json({ ok: true }); });
  await client.uploadCertificate(id, { body: original, filename: '../필증 이름.pdf', expectedUpdatedAt: '2026-10-25T01:00:00+09:00', requestId: nonce });
  assert.equal(calls.length, 1);
  await assert.rejects(client.uploadCertificate(id, { body: original, filename: '필증.pdf' }), error => error.code === 'MISSING_EXPECTED_REVISION');
  await assert.rejects(client.uploadCertificate(id, { body: Buffer.from('<html>bad</html>'), expectedUpdatedAt: null }), error => error.code === 'INVALID_CERTIFICATE_TYPE');
  await assert.rejects(client.uploadCertificate(id, { body: Buffer.alloc(20 * 1024 * 1024 + 1), expectedUpdatedAt: null }), error => error.httpStatus === 413);
  assert.equal(calls.length, 1);
});

test('asset download streams bytes, decodes safe filename and validates declared size', async () => {
  const body = '%PDF-example';
  const { client } = mockClient((url, init) => { verifyCall(url, init); assert.equal(new URL(url).searchParams.get('asset'), 'certificate'); return new Response(body, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(Buffer.byteLength(body)), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('../필증.pdf')}` } }); });
  const asset = await client.downloadAsset(id, 'certificate');
  assert.equal(asset.filename, '_필증.pdf'); assert.equal(asset.contentType, 'application/pdf'); assert.equal(asset.contentLength, Buffer.byteLength(body)); assert.equal(await new Response(asset.body).text(), body);
  await assert.rejects(client.downloadAsset(id, 'untrusted'), error => error.code === 'INVALID_ASSET_KIND');
  const mismatch = await mockClient(() => new Response(body, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '200' } })).client.downloadAsset(id, 'certificate');
  await assert.rejects(new Response(mismatch.body).arrayBuffer(), error => error.code === 'ASSET_LENGTH_MISMATCH');
  await assert.rejects(mockClient(() => new Response('bad', { headers: { 'Content-Type': 'text/html' } })).client.downloadAsset(id, 'certificate'), error => error.code === 'INVALID_ASSET_RESPONSE');
  await assert.rejects(mockClient(() => new Response(body, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(26 * 1024 * 1024) } })).client.downloadAsset(id, 'certificate'), error => error.code === 'ASSET_TOO_LARGE');
});

test('network, redirect and remote errors never expose secret or private URLs', async () => {
  for (const message of [`failed ${secret}`, 'failed https://private.example/signed?token=private']) {
    const { client } = mockClient(() => json({ error: message }, 500));
    await assert.rejects(client.health(), error => error.httpStatus === 500 && !error.message.includes(secret) && !error.message.includes('private.example'));
  }
  await assert.rejects(mockClient(() => { throw new Error(`network failure ${secret}`); }).client.health(), error => error.code === 'DESK_CONNECTION_FAILED' && !error.message.includes(secret));
  const redirected = json({ protocol: 2 }); Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(mockClient(() => redirected).client.health(), error => error.code === 'DESK_REDIRECT_BLOCKED');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(mockClient(() => { throw new DOMException('Aborted', 'AbortError'); }).client.health({ signal: controller.signal }), error => error.code === 'DESK_REQUEST_ABORTED');
});

test('oversized and non-JSON service responses fail safely', async () => {
  await assert.rejects(mockClient(() => new Response('<html>deployment error</html>')).client.health(), error => error.code === 'INVALID_REMOTE_RESPONSE');
  await assert.rejects(mockClient(() => new Response('{}', { headers: { 'Content-Length': String(4 * 1024 * 1024) } })).client.health(), error => error.code === 'RESPONSE_TOO_LARGE');
});

test('storage list is a signed read that keeps only listed fields', async () => {
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init); assert.equal(new URL(url).pathname, '/api/internal/review-desk/storage'); assert.equal(init.method, 'GET');
    return json({ ok: true, items: [{ submissionId: id, title: '검증 영상', artistName: '검증 가수', type: 'MV_DISTRIBUTION', refunded: false, finishedAt: '2026-11-02T04:43:00Z', fileCount: 1, totalBytes: 438763634, objectKey: 'submissions/private/video.mp4' }, { submissionId: 'not-an-id', title: 'x' }] });
  });
  const result = await client.listStorage();
  assert.equal(calls.length, 1);
  assert.deepEqual(result.items, [{ submissionId: id, title: '검증 영상', artistName: '검증 가수', type: 'MV_DISTRIBUTION', refunded: false, paymentPending: false, stage: 'finished', finishedAt: '2026-11-02T04:43:00Z', fileCount: 1, totalBytes: 438763634, files: [] }]);
  assert.equal(result.inventory, null);
  await assert.rejects(mockClient(() => json({ ok: true })).client.listStorage(), error => error.code === 'INVALID_STORAGE_LIST');
});

test('storage inventory is asked for in the signed path and keeps only listed leftover fields', async () => {
  const leftover = 'a'.repeat(32);
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init);
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { scope: 'received', inventory: '1' });
    return json({ ok: true, items: [{ submissionId: id, title: '머쉬베놈', type: 'MV_DISTRIBUTION', stage: 'in_review', paymentPending: true, fileCount: 1, totalBytes: 2225000000, files: [{ id: 'file', source: 'upload', sizeBytes: 2225000000 }] }],
      inventory: { checkedAt: '2026-11-10T09:00:00Z', truncated: false, totalBytes: 2765000000, totalVersions: 9, hiddenMarkers: 2, keys: 7,
        groups: [{ key: 'purgeable', count: 1, bytes: 2225000000 }, { key: 'leftover', count: 4, bytes: 540000000 }, { key: 'made-up', count: 1, bytes: 1 }],
        held: [{ submissionId: id, title: '데모', reason: '작성 중인 신청', count: 1, bytes: 5 }, { submissionId: 'bad' }],
        leftovers: [{ id: leftover, reason: 'hidden_upload', name: '_HEDA_HUG_MV_.mp4', submissionId: id, submissionTitle: 'HUG', bytes: 539000000, versionCount: 2, lastModified: '2026-11-03T17:46:01Z', key: 'submissions/private/old.mp4', versions: [{ versionId: 'v' }] },
          { id: 'not-hex', reason: 'hidden_upload' }, { id: 'b'.repeat(32), reason: 'invented' }] } });
  });
  const result = await client.listStorage({ scope: 'received', inventory: true });
  assert.equal(calls.length, 1);
  assert.equal(result.items[0].paymentPending, true);
  assert.deepEqual(result.inventory.groups.map(group => group.key), ['purgeable', 'held', 'leftover', 'certificate', 'mail_pending', 'recent', 'other']);
  assert.deepEqual(result.inventory.groups[2], { key: 'leftover', count: 4, bytes: 540000000 });
  assert.equal(result.inventory.held.length, 1);
  assert.deepEqual(result.inventory.leftovers, [{ id: leftover, reason: 'hidden_upload', name: '_HEDA_HUG_MV_.mp4', submissionId: id, submissionTitle: 'HUG', bytes: 539000000, versionCount: 2, lastModified: '2026-11-03T17:46:01Z' }]);
});

test('leftover deletion signs one batch of listed ids', async () => {
  const leftover = 'c'.repeat(32);
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body.toString()), { operation: 'leftovers', ids: [leftover], requestId: init.headers['x-onside-desk-request'] });
    return json({ ok: true, results: [{ id: leftover, ok: true, deletedVersions: 2, failedVersions: 0, freedBytes: 539000000 }] });
  });
  assert.equal((await client.purgeLeftovers([leftover], { requestId: nonce })).results[0].deletedVersions, 2);
  for (const ids of [[], Array.from({ length: 26 }, (_, index) => index.toString(16).padStart(32, '0')), [leftover, leftover], ['submissions/private/old.mp4'], 'x']) await assert.rejects(client.purgeLeftovers(ids), error => error.httpStatus === 400);
  assert.equal(calls.length, 1);
});

test('storage purge signs one batch with the same request ID in header and JSON', async () => {
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init); assert.equal(new URL(url).pathname, '/api/internal/review-desk/storage'); assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body.toString());
    assert.deepEqual(body, { operation: 'purge', submissionIds: [id], requestId: init.headers['x-onside-desk-request'] });
    return json({ ok: true, results: [{ submissionId: id, ok: true, deletedFiles: 1, failedFiles: 0, freedBytes: 438763634 }] });
  });
  assert.equal((await client.purgeStorage([id], { requestId: nonce })).results[0].deletedFiles, 1);
  assert.equal(calls[0].init.headers['x-onside-desk-request'], nonce);
  const many = Array.from({ length: 11 }, (_, index) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`);
  for (const ids of [[], many, [id, id], ['../storage'], 'not-a-list']) await assert.rejects(client.purgeStorage(ids), error => error.httpStatus === 400);
  assert.equal(calls.length, 1);
});

test('guest album intake signs the request ID that becomes the lookup code and checks the reply', async () => {
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init); assert.equal(new URL(url).pathname, '/api/internal/review-desk/intake');
    if (init.method === 'GET') return json({ ok: true, packages: [{ id, name: '13곳 패키지', stationCount: 13, priceKrw: 130000, stations: ['KBS'] }, { id: 'bad' }] });
    const body = JSON.parse(init.body.toString());
    assert.equal(body.operation, 'register-guest-album'); assert.equal(body.requestId, init.headers['x-onside-desk-request']); assert.equal(body.guest.name, '홍길동');
    return json({ ok: true, created: true, submissionId: id, guestToken: body.requestId, trackUrl: `https://onside.example/track/${body.requestId}`, paid: true });
  });
  assert.deepEqual((await client.listIntakePackages()).packages, [{ id, name: '13곳 패키지', stationCount: 13, priceKrw: 130000, stations: ['KBS'] }]);
  const registered = await client.registerGuestAlbum({ packageId: id, paid: true, guest: { name: '홍길동' }, submission: {}, tracks: [] }, { requestId: nonce });
  assert.deepEqual(registered, { submissionId: id, guestToken: nonce, trackUrl: `https://onside.example/track/${nonce}`, created: true, paid: true });
  assert.equal(calls.length, 2);
  const mismatched = mockClient(() => json({ ok: true, submissionId: id, guestToken: '99999999-9999-4999-8999-999999999999', trackUrl: 'https://onside.example/track/x' })).client;
  await assert.rejects(mismatched.registerGuestAlbum({ guest: {} }, { requestId: nonce }), error => error.code === 'INVALID_INTAKE_RESULT');
  const insecure = mockClient((url, init) => json({ ok: true, submissionId: id, guestToken: JSON.parse(init.body.toString()).requestId, trackUrl: 'http://onside.example/track/x' })).client;
  await assert.rejects(insecure.registerGuestAlbum({ guest: {} }, { requestId: nonce }), error => error.code === 'INVALID_INTAKE_RESULT');
});

test('album info sync posts the album-info operation with a fresh request ID and reads the counts', async () => {
  const { client, calls } = mockClient((url, init) => {
    verifyCall(url, init); assert.equal(new URL(url).pathname, `/api/internal/review-desk/${id}`); assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body.toString());
    assert.equal(body.operation, 'album-info'); assert.equal(body.requestId, init.headers['x-onside-desk-request']);
    assert.equal(body.submission.releaseDate, '2026-11-05'); assert.equal(body.tracks[0].trackTitle, '첫 곡');
    return json({ ok: true, changed: true, albumInfo: { updatedFields: ['release_date'], updatedTracks: 1, insertedTracks: 0 } });
  });
  const result = await client.saveAlbumInfo(id, { submission: { releaseDate: '2026-11-05' }, tracks: [{ trackNo: 1, trackTitle: '첫 곡' }] });
  assert.deepEqual(result, { changed: true, albumInfo: { updatedFields: ['release_date'], updatedTracks: 1, insertedTracks: 0 } });
  assert.equal(calls.length, 1);
  await assert.rejects(client.saveAlbumInfo(id, { submission: {} }), error => error.code === 'INVALID_ALBUM_INFO');
  await assert.rejects(mockClient(() => json({ ok: false })).client.saveAlbumInfo(id, { submission: {}, tracks: [] }), error => error.code === 'INVALID_ALBUM_INFO_RESULT');
  await assert.rejects(mockClient(() => json({ ok: false, error: '음반 접수에만 신청서 정보를 반영할 수 있습니다.', errorCode: 'INVALID_TYPE' }, 400)).client.saveAlbumInfo(id, { submission: {}, tracks: [] }), error => error.code === 'INVALID_TYPE');
});

test('the received scope is signed into the path and in-review purges carry the local-copy declaration', async () => {
  const seen = [];
  const { client } = mockClient((url, init) => {
    verifyCall(url, init); seen.push({ path: new URL(url).pathname + new URL(url).search, method: init.method, body: init.method === 'POST' ? JSON.parse(init.body.toString()) : null });
    if (init.method === 'GET') return json({ ok: true, items: [{ submissionId: id, stage: 'in_review', files: [{ id: 'f1', source: 'upload', sizeBytes: 9, objectKey: 'x' }, { id: '' }] }] });
    return json({ ok: true, results: [] });
  });
  const listed = await client.listStorage({ scope: 'received' });
  assert.equal(seen[0].path, '/api/internal/review-desk/storage?scope=received');
  assert.deepEqual(listed.items[0].files, [{ id: 'f1', source: 'upload', sizeBytes: 9 }]); assert.equal(listed.items[0].stage, 'in_review');
  await assert.rejects(client.purgeStorage([id], { scope: 'received' }), error => error.code === 'LOCAL_COPIES_REQUIRED');
  await client.purgeStorage([id], { scope: 'received', localCopiesVerified: true });
  assert.equal(seen.at(-1).body.scope, 'received'); assert.equal(seen.at(-1).body.localCopiesVerified, true);
  await client.purgeStorage([id]);
  assert.equal(seen.at(-1).body.scope, undefined);
});
