import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createSource, normalizeAssets, readOnlyFetch, sanitizeRecord, sourceStatus } from './source.mjs';

const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
  B2_S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', B2_REGION: 'us-west-004',
  B2_BUCKET: 'onside', B2_KEY_ID: 'test-key-id', B2_APPLICATION_KEY: 'test-key', B2_PREFIX: 'submissions',
};
const id = '8f7b615a-b072-4782-a965-0c20c4a120a1';
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('read-only guard rejects writes, RPC and foreign servers before sending', async () => {
  const seen = [];
  const fetcher = readOnlyFetch(env.SUPABASE_URL, async (url, init) => { seen.push({ url, init }); return json([]); });
  await fetcher(`${env.SUPABASE_URL}/rest/v1/submissions`, { method: 'GET' });
  for (const [url, method] of [
    [`${env.SUPABASE_URL}/rest/v1/submissions`, 'PATCH'],
    [`${env.SUPABASE_URL}/rest/v1/submissions`, 'POST'],
    [`${env.SUPABASE_URL}/rest/v1/rpc/update_submission`, 'GET'],
    ['https://other.example/rest/v1/submissions', 'GET'],
    [`${env.SUPABASE_URL}/auth/v1/admin/users`, 'DELETE'],
  ]) await assert.rejects(fetcher(url, { method }), /조회와 파일 다운로드/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.redirect, 'error');
});

test('list paginates without leaking access tokens or excluding unpaid submissions', async () => {
  const seen = [];
  const source = createSource({ env, fetchImpl: async (input, init) => {
    const url = new URL(input); seen.push(url);
    assert.equal(init.method, 'GET');
    assert.equal(url.searchParams.get('status'), 'neq.DRAFT');
    assert.equal(url.searchParams.has('payment_status'), false);
    const offset = Number(url.searchParams.get('offset'));
    return json(Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({ id: String(offset + index), payment_status: 'UNPAID', guest_token: 'hidden', save_lease_token: 'hidden' })));
  } });
  const rows = await source.fetchSubmissions();
  assert.equal(rows.length, 501);
  assert.deepEqual(seen.map(url => url.searchParams.get('offset')), ['0', '500']);
  assert.equal('guest_token' in rows[0], false);
  assert.equal('save_lease_token' in rows[0], false);
});

test('detail combines tracks, station results, email delivery, profile and certificate without remote mutation', async () => {
  const source = createSource({ env, fetchImpl: async input => {
    const table = new URL(input).pathname.split('/').at(-1);
    return json({
      submissions: { id, type: 'ALBUM', user_id: id, package_id: id, files_submitted_by_email: true, guest_token: 'hidden', certificate_b2_path: 'submissions/certificate.pdf' },
      album_tracks: [{ id, track_no: 1, track_title: '새 노래', lyrics: '가사' }],
      submission_files: [{ id, file_path: 'submissions/song.wav', kind: 'AUDIO', status: 'UPLOADED', size: 5 }],
      station_reviews: [{ id, station_id: id, status: 'PASSED', track_results_json: { 1: 'PASSED' } }],
      stations: [{ id, name: '한국방송', code: 'KBS' }],
      submission_events: [{ id, event_type: 'SUBMITTED' }],
      profiles: { name: '담당자', email: 'owner@example.test', phone: '010-0000-0000' },
      packages: { id, name: '기본', station_count: 7 },
    }[table]);
  } });
  const detail = await source.fetchSubmission(id);
  assert.equal(detail.submission.applicant_name, '담당자');
  assert.equal(detail.submission.files_submitted_by_email, true);
  assert.equal(detail.tracks[0].track_title, '새 노래');
  assert.equal(detail.stationReviews[0].station.code, 'KBS');
  assert.deepEqual(detail.stationReviews[0].track_results, { 1: 'PASSED' });
  assert.equal(detail.assets.length, 2);
  assert.equal('guest_token' in detail.submission, false);
});

test('asset normalization ignores unfinished and purged uploads and blocks foreign URLs/path traversal', () => {
  const assets = normalizeAssets([
    { id: 'pending', file_path: 'submissions/incomplete.wav', status: 'PENDING' },
    { id: 'purged', file_path: 'submissions/deleted-after-review.wav', status: 'UPLOADED', purged_at: '2026-11-01T00:00:00Z' },
    { id: 'audio', file_path: 'submissions/곡.wav' },
    { id: 'duplicate', file_path: 'submissions/곡.wav' },
    { id: 'bad-prefix', file_path: 'somewhere/secret.wav' },
    { id: 'outside', file_path: 'https://outside.example/a.mp4' },
    { id: 'traversal', file_path: 'submissions/../private' },
    { id: 'legacy', file_path: `${env.SUPABASE_URL}/storage/v1/object/public/media/video.mp4?x=1` },
  ], {}, env);
  assert.equal(assets.length, 5);
  assert.equal(assets.find(asset => asset.id === 'audio').downloadable, true);
  for (const id of ['outside', 'traversal', 'bad-prefix']) assert.equal(assets.find(asset => asset.id === id).downloadable, false);
  assert.equal(assets.find(asset => asset.id === 'legacy').storage, 'supabase');
});

test('download streams verified bytes and refuses to replace a local file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onside-source-'));
  const payload = Buffer.from('음원 파일 테스트');
  const commands = [];
  const source = createSource({ env, s3Client: { send: async command => {
    commands.push(command.constructor.name);
    return { Body: Readable.from([payload]), ContentLength: payload.length };
  } } });
  const asset = { objectKey: 'submissions/song.wav', storage: 'b2', bucket: 'onside', size: payload.length };
  try {
    const target = join(directory, 'song.wav');
    const result = await source.downloadAsset(asset, target);
    assert.equal(result.bytes, payload.length);
    assert.equal(result.sha256, createHash('sha256').update(payload).digest('hex'));
    assert.deepEqual(await readFile(target), payload);
    await writeFile(target, '사용자가 편집한 파일');
    await assert.rejects(source.downloadAsset(asset, target), /EEXIST/);
    assert.equal(await readFile(target, 'utf8'), '사용자가 편집한 파일');
    assert.deepEqual(await readdir(directory), ['song.wav']);
    assert.deepEqual(commands, ['GetObjectCommand', 'GetObjectCommand']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('truncated download removes partial file and does not create final file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onside-source-'));
  const source = createSource({ env, s3Client: { send: async () => ({ Body: Readable.from([Buffer.from('short')]), ContentLength: 100 }) } });
  try {
    await assert.rejects(source.downloadAsset({ objectKey: 'submissions/song.wav', size: 100 }, join(directory, 'song.wav')), /크기가 일치하지/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('status never returns credentials, sanitization is recursive', () => {
  assert.equal(sourceStatus(env).downloadsConfigured, true);
  assert.equal(JSON.stringify(sourceStatus(env)).includes('test-server-key'), false);
  assert.deepEqual(sanitizeRecord({ nested: [{ access_token: 'secret', title: '앨범' }], guest_token: 'secret' }), { nested: [{ title: '앨범' }] });
});

test('with the Cloudflare link configured, originals come through the Worker with a link the Worker accepts', async () => {
  const { handle } = await import('../../services/files-cdn/src/index.mjs');
  const secret = 'desk-fixture-signing-secret-of-32-chars!';
  const cdnEnv = { ...env, FILES_CDN_BASE_URL: 'https://onside-files.example.workers.dev', FILES_CDN_SIGNING_SECRET: secret };
  const workerEnv = { B2_S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', B2_REGION: 'us-west-004', B2_BUCKET: 'onside', B2_KEY_ID: 'kid', B2_APPLICATION_KEY: 'key', FILES_SIGNING_SECRET: secret };
  const payload = Buffer.from('cloudflare 경유 음원');
  const upstream = [];
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://onside-files.example.workers.dev');
    assert.equal(init.redirect, 'error');
    // Run the real Worker against a fake B2 so the signed link is verified end to end.
    return handle(new Request(url), workerEnv, { fetchImpl: async (b2Url, b2Init) => { upstream.push({ b2Url, method: b2Init.method }); return new Response(payload, { headers: { 'content-length': String(payload.length) } }); } });
  };
  const source = createSource({ env: cdnEnv, fetchImpl, s3Client: { send: async () => { throw new Error('direct B2 must not be used'); } } });
  assert.equal(sourceStatus(cdnEnv).downloadsVia, 'cloudflare');
  assert.equal(sourceStatus({ ...cdnEnv, B2_KEY_ID: '', B2_APPLICATION_KEY: '' }).downloadsConfigured, true);
  const directory = await mkdtemp(join(tmpdir(), 'onside-source-cdn-'));
  try {
    const result = await source.downloadAsset({ objectKey: 'submissions/곡 01.wav', storage: 'b2', bucket: 'onside', size: payload.length, original_name: '곡 01.wav' }, join(directory, 'song.wav'));
    assert.equal(result.bytes, payload.length);
    assert.deepEqual(await readFile(join(directory, 'song.wav')), payload);
    assert.deepEqual(upstream, [{ b2Url: 'https://s3.us-west-004.backblazeb2.com/onside/submissions/%EA%B3%A1%2001.wav', method: 'GET' }]);
    const capped = createSource({ env: cdnEnv, fetchImpl: async () => new Response('limit', { status: 503 }) });
    await assert.rejects(capped.downloadAsset({ objectKey: 'submissions/a.wav', storage: 'b2', bucket: 'onside' }, join(directory, 'a.wav')), /하루 다운로드 한도/);
    assert.deepEqual(await readdir(directory), ['song.wav']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the module the installed desk imports exposes every source function the server uses, including unread chats', async () => {
  const module = await import('./source.mjs');
  for (const name of ['sourceStatus', 'fetchSubmissions', 'fetchSubmission', 'downloadAsset', 'fetchUnreadChats']) assert.equal(typeof module[name], 'function', name);
  // Unread chats are read through the same read-only guard: GET on the conversations table only.
  const seen = [];
  const source = createSource({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture' }, fetchImpl: async (url, init) => { seen.push({ url: String(url), method: init.method }); return new Response(JSON.stringify([{ id: 'c1', guest_name: '홍길동', access_token: 'secret', unread_admin_count: 1 }]), { headers: { 'content-type': 'application/json' } }); } });
  const rows = await source.fetchUnreadChats();
  assert.equal(rows[0].guest_name, '홍길동'); assert.equal(rows[0].access_token, undefined);
  assert.match(seen[0].url, /\/rest\/v1\/support_chat_conversations\?.*unread_admin_count=gt\.0/);
  assert.equal(seen[0].method, 'GET');
});
