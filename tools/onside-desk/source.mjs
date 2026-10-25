/** Read-only service adapter. Never import this module in browser code. */
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const TABLES = new Set(['submissions', 'album_tracks', 'submission_files', 'station_reviews', 'stations', 'submission_events', 'profiles', 'packages']);
const PAGE_SIZE = 500;
const MAXIMUM_ASSET_BYTES = 50 * 1024 ** 3;
const text = value => typeof value === 'string' ? value.trim() : '';

function configuration(env) {
  return {
    url: text(env.SUPABASE_URL) || text(env.NEXT_PUBLIC_SUPABASE_URL),
    key: text(env.SUPABASE_SERVICE_ROLE_KEY) || text(env.SUPABASE_SERVICE_KEY) || text(env.SUPABASE_SECRET_KEY),
    endpoint: text(env.B2_S3_ENDPOINT), region: text(env.B2_REGION), bucket: text(env.B2_BUCKET),
    keyId: text(env.B2_KEY_ID), applicationKey: text(env.B2_APPLICATION_KEY),
    prefix: `${text(env.B2_PREFIX).replace(/^\/+|\/+$/g, '') || 'submissions'}/`,
  };
}

function validateHttps(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} 주소 설정을 확인해주세요.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${label}은 경로와 인증정보가 없는 HTTPS 주소여야 합니다.`);
  }
  return url.origin;
}

export function sourceStatus(env = process.env) {
  const config = configuration(env);
  const missing = [];
  if (!config.url) missing.push('SUPABASE_URL');
  if (!config.key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  const databaseConfigured = missing.length === 0;
  for (const [key, name] of [['endpoint', 'B2_S3_ENDPOINT'], ['region', 'B2_REGION'], ['bucket', 'B2_BUCKET'], ['keyId', 'B2_KEY_ID'], ['applicationKey', 'B2_APPLICATION_KEY']]) {
    if (!config[key]) missing.push(name);
  }
  return { configured: databaseConfigured, databaseConfigured, downloadsConfigured: missing.length === 0, mode: 'read-only', missing };
}

/** A transport guard makes all writes fail even if future adapter code is changed. */
export function readOnlyFetch(origin, fetchImpl = globalThis.fetch) {
  const allowedOrigin = validateHttps(origin, 'Supabase');
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init.method || input?.method || 'GET').toUpperCase();
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    const storage = /^\/storage\/v1\/object\/authenticated\/[^/]+\/.+/.test(url.pathname);
    if (url.origin !== allowedOrigin || !['GET', 'HEAD'].includes(method) || !(TABLES.has(table) || storage)) {
      throw new Error('온사이드 데스크는 신청 조회와 파일 다운로드만 허용합니다.');
    }
    const timeout = AbortSignal.timeout(storage ? 30 * 60_000 : 30_000);
    const sourceSignal = init.signal || input?.signal;
    return fetchImpl(input, {
      ...init, method, redirect: 'error', cache: 'no-store',
      signal: sourceSignal ? AbortSignal.any([sourceSignal, timeout]) : timeout,
    });
  };
}

/** Remove access tokens and internal payment payloads before local persistence/UI. */
export function sanitizeRecord(value) {
  if (Array.isArray(value)) return value.map(sanitizeRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|password|secret|credential|raw_response|raw_payload|save_lease)/i.test(key))
    .map(([key, item]) => [key, sanitizeRecord(item)]));
}

function sourceError(context, error) {
  const code = typeof error?.code === 'string' && /^[A-Z\d_]+$/.test(error.code) ? ` (${error.code})` : '';
  return new Error(`${context}에 실패했습니다${code}. 네트워크와 연결 설정을 확인해주세요.`);
}

function assertId(id) {
  if (!UUID.test(String(id))) throw new Error('신청 ID가 올바르지 않습니다.');
}

function missingOptionalTable(error) {
  return ['42P01', 'PGRST205'].includes(error?.code);
}

export function normalizeAssets(files = [], submission = {}, env = process.env) {
  const config = configuration(env);
  const records = [...files];
  if (submission.certificate_b2_path && !records.some(file => (file.object_key || file.file_path) === submission.certificate_b2_path)) {
    records.push({ id: `certificate-${submission.id}`, submission_id: submission.id, kind: 'CERTIFICATE', file_path: submission.certificate_b2_path, original_name: submission.certificate_original_name || '심의필증.pdf', size: submission.certificate_size, mime: submission.certificate_mime });
  }
  const seen = new Set();
  return records.flatMap(file => {
    if (file.status && file.status !== 'UPLOADED') return [];
    const key = text(file.object_key) || text(file.file_path);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    let storage = 'b2'; let objectKey = key; let bucket = config.bucket; let supported = true;
    // Older records may use an authenticated/public URL in this same Supabase project.
    if (/^https?:\/\//i.test(key)) {
      try {
        const url = new URL(key);
        const path = url.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
        if (url.origin !== new URL(config.url).origin || !path) supported = false;
        else { storage = 'supabase'; bucket = decodeURIComponent(path[1]); objectKey = decodeURIComponent(path[2]); }
      } catch { supported = false; }
    } else if (!key.startsWith(config.prefix)) supported = false;
    if (objectKey.includes('\0') || objectKey.split('/').some(part => part === '..' || part === '.')) supported = false;
    return [{ ...sanitizeRecord(file), id: file.id || createHash('sha256').update(key).digest('hex').slice(0, 24), storage, bucket, objectKey, downloadable: supported, original_name: file.original_name || objectKey.split('/').at(-1) || '첨부파일', size: Number(file.size) || null }];
  });
}

export function createSource({ env = process.env, fetchImpl = globalThis.fetch, s3Client } = {}) {
  let client; let b2;
  const getClient = () => {
    if (client) return client;
    const config = configuration(env);
    if (!sourceStatus(env).databaseConfigured) throw new Error('온사이드 연결 설정이 없습니다. 앱의 연결 설정 파일을 확인해주세요.');
    const origin = validateHttps(config.url, 'Supabase');
    client = createClient(origin, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: readOnlyFetch(origin, fetchImpl) },
    });
    return client;
  };
  const allRows = async (table, build = query => query, { optional = false } = {}) => {
    const all = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await build(getClient().from(table).select('*')).range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        if (optional && missingOptionalTable(error)) return null;
        throw sourceError(`${table} 조회`, error);
      }
      if (!Array.isArray(data)) throw new Error(`${table} 조회 결과를 확인할 수 없습니다.`);
      all.push(...data);
      if (data.length < PAGE_SIZE) return sanitizeRecord(all);
      if (all.length >= 100_000) throw new Error('신청 건수가 많아 조회를 중단했습니다. 날짜 범위를 좁혀주세요.');
    }
  };

  async function fetchSubmissions({ since, includeDrafts = false } = {}) {
    if (since && Number.isNaN(Date.parse(since))) throw new Error('동기화 시작 날짜가 올바르지 않습니다.');
    return allRows('submissions', query => {
      let filtered = query.order('updated_at', { ascending: false }).order('id', { ascending: true });
      if (!includeDrafts) filtered = filtered.neq('status', 'DRAFT');
      if (since) filtered = filtered.gte('updated_at', new Date(since).toISOString());
      return filtered;
    });
  }

  async function fetchSubmission(id) {
    assertId(id);
    const { data: raw, error } = await getClient().from('submissions').select('*').eq('id', id).maybeSingle();
    if (error) throw sourceError('신청 상세 조회', error);
    if (!raw) throw new Error('신청이 없거나 접근할 수 없습니다. 동기화 후 다시 확인해주세요.');
    const submission = sanitizeRecord(raw);
    const warnings = [];
    const [tracks, files, reviews, stations, events] = await Promise.all([
      allRows('album_tracks', query => query.eq('submission_id', id).order('track_no').order('id')),
      allRows('submission_files', query => query.eq('submission_id', id).order('created_at').order('id')),
      allRows('station_reviews', query => query.eq('submission_id', id).order('station_id').order('id')),
      allRows('stations', query => query.order('code').order('id')),
      allRows('submission_events', query => query.eq('submission_id', id).order('created_at', { ascending: false }).order('id'), { optional: true }),
    ]);
    if (!events) warnings.push('서비스에 접수 이력 테이블이 없어 이력을 불러오지 못했습니다.');
    if (submission.package_id) {
      const result = await getClient().from('packages').select('id,name,station_count,price_krw').eq('id', submission.package_id).maybeSingle();
      if (result.error) warnings.push('신청 패키지 정보를 불러오지 못했습니다.');
      else submission.package = result.data;
    }
    if (submission.user_id && (!submission.applicant_name || !submission.applicant_email || !submission.applicant_phone)) {
      const result = await getClient().from('profiles').select('name,company,phone').eq('user_id', submission.user_id).maybeSingle();
      if (result.error) warnings.push('회원 연락처를 불러오지 못했습니다. 신청서에 입력된 연락처를 사용합니다.');
      else if (result.data) {
        submission.applicant_name ||= result.data.name;
        submission.applicant_phone ||= result.data.phone;
        submission.applicant_company ||= result.data.company;
      }
    }
    submission.applicant_name ||= submission.guest_name;
    submission.applicant_email ||= submission.guest_email;
    submission.applicant_phone ||= submission.guest_phone;
    submission.applicant_company ||= submission.guest_company;
    submission.album_tracks = tracks;
    const stationMap = new Map(stations.map(station => [station.id, station]));
    const stationReviews = reviews.map(review => ({ ...review, station: stationMap.get(review.station_id) || null, track_results: review.track_results_json ?? review.track_results }));
    const assets = normalizeAssets(files, submission, env);
    if (assets.some(asset => !asset.downloadable)) warnings.push('허용된 온사이드 저장소 밖의 첨부파일이 있습니다. 해당 파일은 자동 다운로드하지 않습니다.');
    return { submission, tracks, files, assets, stationReviews, stations, events: events || [], warnings };
  }

  async function downloadAsset(asset, destination, { signal, onProgress } = {}) {
    const config = configuration(env);
    if (!asset || asset.downloadable === false || !text(asset.objectKey)) throw new Error('다운로드할 수 없는 파일입니다.');
    const key = text(asset.objectKey);
    if (key.includes('\0') || key.split('/').some(part => part === '..' || part === '.')) throw new Error('잘못된 파일 경로입니다.');
    const deadline = AbortSignal.timeout(30 * 60_000);
    const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    abortSignal.throwIfAborted();
    let body; let expectedLength;
    if (asset.storage === 'supabase') {
      if (!asset.bucket || /[/\\]/.test(asset.bucket)) throw new Error('잘못된 저장소 이름입니다.');
      const origin = validateHttps(config.url, 'Supabase');
      const url = `${origin}/storage/v1/object/authenticated/${encodeURIComponent(asset.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
      const response = await readOnlyFetch(origin, fetchImpl)(url, { signal: abortSignal, headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
      if (!response.ok || !response.body) throw new Error(`첨부파일을 내려받지 못했습니다 (HTTP ${response.status}).`);
      body = Readable.fromWeb(response.body);
      const contentLength = response.headers.get('content-length');
      expectedLength = contentLength == null ? null : Number(contentLength);
    } else {
      if (!key.startsWith(config.prefix) || (asset.bucket && asset.bucket !== config.bucket)) throw new Error('온사이드 신청 폴더 밖의 파일은 내려받을 수 없습니다.');
      if (!sourceStatus(env).downloadsConfigured) throw new Error('음원·영상 다운로드 연결 설정이 없습니다.');
      if (!b2) b2 = s3Client || new S3Client({ endpoint: validateHttps(config.endpoint, 'B2'), region: config.region, forcePathStyle: true, credentials: { accessKeyId: config.keyId, secretAccessKey: config.applicationKey } });
      try {
        const object = await b2.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal });
        body = object.Body; expectedLength = object.ContentLength;
      } catch (error) { throw sourceError('첨부파일 다운로드', error); }
    }
    if (!body || (expectedLength ?? asset.size ?? 0) > MAXIMUM_ASSET_BYTES) {
      body?.destroy?.();
      throw new Error('파일이 없거나 50GB 다운로드 제한을 초과합니다.');
    }
    const output = resolve(destination);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    const temporary = `${output}.partial-${randomUUID()}`;
    const hash = createHash('sha256'); let bytes = 0; let lastProgress = 0;
    const measure = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAXIMUM_ASSET_BYTES) return callback(new Error('50GB 다운로드 제한을 초과했습니다.'));
      hash.update(chunk);
      if (onProgress && Date.now() - lastProgress > 250) { lastProgress = Date.now(); onProgress({ bytes, total: expectedLength || asset.size || null }); }
      callback(null, chunk);
    } });
    try {
      await pipeline(body, measure, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: abortSignal });
      if (expectedLength != null && bytes !== Number(expectedLength)) throw new Error('다운로드한 파일 크기가 일치하지 않습니다. 다시 시도해주세요.');
      if (asset.size != null && Number(asset.size) > 0 && bytes !== Number(asset.size)) throw new Error('신청서에 등록된 파일 크기와 다운로드 크기가 다릅니다. 원본 변경 여부를 확인해주세요.');
      const sha256 = hash.digest('hex');
      if (/^[a-f\d]{64}$/i.test(asset.checksum || '') && sha256 !== asset.checksum.toLowerCase()) throw new Error('다운로드한 파일의 검증값이 일치하지 않습니다.');
      // link fails if destination already exists; never replace a user's local file.
      await link(temporary, output);
      onProgress?.({ bytes, total: bytes });
      return { path: output, bytes, sha256 };
    } finally { body?.destroy?.(); await unlink(temporary).catch(() => {}); }
  }

  return { sourceStatus: () => sourceStatus(env), fetchSubmissions, fetchSubmission, downloadAsset };
}

const defaultSource = createSource();
export const fetchSubmissions = options => defaultSource.fetchSubmissions(options);
export const fetchSubmission = id => defaultSource.fetchSubmission(id);
export const downloadAsset = (asset, destination, options) => defaultSource.downloadAsset(asset, destination, options);
