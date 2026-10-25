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

test('asset normalization ignores unfinished uploads and blocks foreign URLs/path traversal', () => {
  const assets = normalizeAssets([
    { id: 'pending', file_path: 'submissions/incomplete.wav', status: 'PENDING' },
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
