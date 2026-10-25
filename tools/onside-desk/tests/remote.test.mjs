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
