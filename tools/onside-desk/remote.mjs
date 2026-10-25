/** Signed result-management requests. This module runs only in the private Mac process. */
import { createHash, createHmac, randomUUID } from 'node:crypto';

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const ASSET_KINDS = new Set(['ratingImage', 'usageGuide', 'certificate']);
const JSON_LIMIT = 3 * 1024 * 1024;
const CERTIFICATE_LIMIT = 20 * 1024 * 1024;
const ASSET_LIMIT = 25 * 1024 * 1024;
const text = value => typeof value === 'string' ? value.trim() : '';

export class RemoteReviewError extends Error {
  constructor(message, status = 503, code = 'DESK_REMOTE_ERROR') {
    super(message); this.name = 'RemoteReviewError'; this.status = status; this.httpStatus = status; this.code = code;
  }
}

/** Must match src/lib/admin/review-desk-auth.ts exactly. */
export function signRemoteReviewRequest(secret, input) {
  const key = createHmac('sha256', secret).update('onside-review-desk:v2').digest();
  const hash = createHash('sha256').update(input.body).digest('hex');
  return createHmac('sha256', key).update([input.method.toUpperCase(), input.path, input.timestamp, input.requestId, input.actorId, hash].join('\n')).digest('hex');
}

function configFor(env, options) {
  const value = text(env.ONSIDE_DESK_SERVICE_URL), actorId = text(env.ONSIDE_DESK_ADMIN_USER_ID), secret = text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!value || !UUID.test(actorId) || !secret) return null;
  try {
    const url = new URL(value);
    const allowedLocal = options.allowInsecureLocalhost === true && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !allowedLocal) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    return { origin: url.origin, actorId, secret };
  } catch { return null; }
}

function requestId(value) {
  if (value === undefined || value === null || value === '') return randomUUID();
  if (!UUID.test(value)) throw new RemoteReviewError('요청 식별자를 확인해 주세요. 화면을 새로고침한 후 다시 시도하세요.', 400, 'INVALID_REQUEST_ID');
  return value;
}
function submissionId(value) {
  if (!UUID.test(String(value))) throw new RemoteReviewError('신청 ID가 올바르지 않습니다.', 400, 'INVALID_SUBMISSION_ID');
  return String(value);
}
function cleanFilename(value, fallback = '심의자료') {
  return String(value || fallback).normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 180) || fallback;
}
function filenameFromHeaders(headers, fallback) {
  const disposition = headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return cleanFilename(decodeURIComponent(encoded)); } catch {} }
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1] || disposition.match(/filename=([^;]+)/i)?.[1];
  return cleanFilename(quoted, fallback);
}
function safeRemoteMessage(data, status, secret) {
  const candidate = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '';
  if (candidate && candidate.length < 1500 && !candidate.includes(secret) && !/(?:https?:\/\/|Bearer\s|[a-z\d_-]{48,})/i.test(candidate)) return candidate.slice(0, 500);
  if (status === 409) return '다른 관리자 작업으로 결과가 변경되었습니다. 최신 결과를 불러온 후 다시 확인해 주세요.';
  if (status === 401 || status === 403) return '온사이드 관리자 연결 인증을 확인해 주세요.';
  if (status === 413) return '파일 또는 입력 내용이 허용 크기를 초과했습니다.';
  if (status === 404) return '온사이드의 결과 연동 경로 또는 신청을 찾을 수 없습니다.';
  return '온사이드 결과 연동 요청을 완료하지 못했습니다. 연결 상태를 확인한 후 다시 시도하세요.';
}
async function boundedBytes(response, limit) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) { await response.body?.cancel(); throw new RemoteReviewError('서비스 응답이 허용 크기를 초과했습니다.', 502, 'RESPONSE_TOO_LARGE'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.length;
      if (size > limit) { await reader.cancel(); throw new RemoteReviewError('서비스 응답이 허용 크기를 초과했습니다.', 502, 'RESPONSE_TOO_LARGE'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
async function jsonBody(response, limit = JSON_LIMIT) {
  const bytes = await boundedBytes(response, limit);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new RemoteReviewError('서비스가 결과 연동 응답을 보내지 못했습니다. 서비스 배포 상태를 확인해 주세요.', 502, 'INVALID_REMOTE_RESPONSE'); }
}

export function createRemoteReviewClient(env = process.env, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const clock = options.now || Date.now;
  const readConfig = () => {
    const config = configFor(env, options);
    if (!config) throw new RemoteReviewError('이 Mac의 온사이드 결과 연동 설정이 필요합니다. 서비스 주소와 관리자 계정을 확인해 주세요.', 503, 'DESK_NOT_CONFIGURED');
    return config;
  };
  async function request(id, { method = 'GET', query, body = Buffer.alloc(0), contentType, idempotencyId, signal, timeout = 120_000 } = {}) {
    const config = readConfig();
    const url = new URL(`/api/internal/review-desk/${id === 'health' ? id : submissionId(id)}`, config.origin);
    if (query) for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value === null ? '' : String(value));
    const timestamp = String(clock()), nonce = requestId(idempotencyId);
    const signed = { method, path: url.pathname + url.search, timestamp, requestId: nonce, actorId: config.actorId, body };
    const headers = { 'Accept': 'application/json', 'x-onside-desk-time': timestamp, 'x-onside-desk-request': nonce, 'x-onside-desk-actor': config.actorId, 'x-onside-desk-signature': signRemoteReviewRequest(config.secret, signed) };
    if (contentType) headers['Content-Type'] = contentType;
    const deadline = AbortSignal.timeout(timeout);
    let response;
    try {
      response = await fetchImpl(url.href, { method, headers, ...(method === 'GET' ? {} : { body }), signal: signal ? AbortSignal.any([signal, deadline]) : deadline, redirect: 'error', cache: 'no-store' });
    } catch (error) {
      if (signal?.aborted) throw new RemoteReviewError('결과 연동 요청이 취소되었습니다. 저장 여부는 최신 결과에서 확인해 주세요.', 499, 'DESK_REQUEST_ABORTED');
      if (deadline.aborted || error?.name === 'TimeoutError') throw new RemoteReviewError('온사이드 응답 시간이 초과되었습니다. 다시 저장하기 전에 최신 결과와 메일 이력을 확인해 주세요.', 504, 'DESK_REQUEST_TIMEOUT');
      throw new RemoteReviewError('온사이드 서비스에 연결하지 못했습니다. 저장 여부는 최신 결과와 메일 이력에서 확인해 주세요.', 503, 'DESK_CONNECTION_FAILED');
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== config.origin)) {
      await response.body?.cancel(); throw new RemoteReviewError('결과 연동 주소가 다른 서버로 이동했습니다. 연결 설정을 확인해 주세요.', 502, 'DESK_REDIRECT_BLOCKED');
    }
    if (!response.ok) {
      const errorData = await jsonBody(response, 64 * 1024).catch(() => null);
      const remoteCode = errorData?.code || errorData?.errorCode;
      const code = typeof remoteCode === 'string' && /^[A-Z\d_]{1,80}$/.test(remoteCode) ? remoteCode : 'DESK_REMOTE_ERROR';
      throw new RemoteReviewError(safeRemoteMessage(errorData, response.status, config.secret), response.status, code);
    }
    return response;
  }
  async function health({ signal } = {}) {
    const data = await jsonBody(await request('health', { signal, timeout: 20_000 }));
    if (data.protocol !== 2 && data.protocolVersion !== 2) throw new RemoteReviewError('온사이드 결과 연동 기능의 버전이 맞지 않습니다. 서비스와 앱을 함께 업데이트해 주세요.', 503, 'DESK_PROTOCOL_MISMATCH');
    return data;
  }
  async function getResults(id, { signal } = {}) {
    const data = await jsonBody(await request(id, { signal, timeout: 30_000 }));
    if (!data || typeof data !== 'object' || !data.submission || !Array.isArray(data.stations)) throw new RemoteReviewError('심의 결과 응답 형식을 확인할 수 없습니다.', 502, 'INVALID_RESULT_SNAPSHOT');
    if (data.assets?.items && !Array.isArray(data.assets.items)) throw new RemoteReviewError('결과 자료 응답 형식을 확인할 수 없습니다.', 502, 'INVALID_RESULT_SNAPSHOT');
    if (data.assets?.items) data.assets.items = data.assets.items.filter(item => item && typeof item === 'object').map(item => {
      const { downloadUrl: _unusedUrl, ...safe } = item;
      void _unusedUrl;
      return { ...safe, ...(ASSET_KINDS.has(item.kind) && (item.available === true || item.ready === true) ? { downloadUrl: `/api/cases/${submissionId(id)}/result-assets/${item.kind}` } : {}) };
    });
    return data;
  }
  async function getEmailPreview(id, { signal } = {}) {
    const data = await jsonBody(await request(id, { query: { preview: 'email' }, signal, timeout: 30_000 }));
    if (!data || typeof data.subject !== 'string' || typeof data.html !== 'string' || typeof data.revision !== 'string' || typeof data.updatedAt !== 'string' || typeof data.canSend !== 'boolean') throw new RemoteReviewError('이메일 미리보기를 불러오지 못했습니다. 최신 결과로 다시 열어 주세요.', 502, 'INVALID_EMAIL_PREVIEW');
    return data;
  }
  async function saveResults(id, payload, { signal } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['station', 'bulk-stations', 'online', 'send', 'resend'].includes(payload.operation)) throw new RemoteReviewError('심의 결과 작업을 확인해 주세요.', 400, 'INVALID_OPERATION');
    const nonce = requestId(payload.requestId);
    let body;
    try { body = Buffer.from(JSON.stringify({ ...payload, requestId: nonce })); }
    catch { throw new RemoteReviewError('결과 입력 형식을 확인해 주세요.', 400, 'INVALID_RESULT_BODY'); }
    if (body.length > JSON_LIMIT) throw new RemoteReviewError('결과 입력 내용이 너무 큽니다.', 413, 'RESULT_BODY_TOO_LARGE');
    return jsonBody(await request(id, { method: 'POST', body, contentType: 'application/json', idempotencyId: nonce, signal }));
  }
  async function uploadCertificate(id, { body: input, filename, expectedUpdatedAt, requestId: requestedId, signal } = {}) {
    if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) throw new RemoteReviewError('업로드할 필증 파일을 확인해 주세요.', 400, 'INVALID_CERTIFICATE');
    if (input.byteLength === 0 || input.byteLength > CERTIFICATE_LIMIT) throw new RemoteReviewError('필증은 20MB 이하의 PDF, PNG, JPG 파일이어야 합니다.', 413, 'CERTIFICATE_TOO_LARGE');
    const body = Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
    const mime = body.subarray(0, 5).equals(Buffer.from('%PDF-')) ? 'application/pdf' : body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : body[0] === 255 && body[1] === 216 && body[2] === 255 ? 'image/jpeg' : null;
    if (!mime) throw new RemoteReviewError('PDF, PNG, JPG 형식의 실제 필증 파일을 선택해 주세요.', 400, 'INVALID_CERTIFICATE_TYPE');
    const nonce = requestId(requestedId);
    const safeFilename = cleanFilename(filename, mime === 'application/pdf' ? '영등위_필증.pdf' : mime === 'image/png' ? '영등위_필증.png' : '영등위_필증.jpg');
    if (expectedUpdatedAt === undefined || (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== 'string')) throw new RemoteReviewError('필증 업로드 전에 최신 결과를 다시 확인해 주세요.', 400, 'MISSING_EXPECTED_REVISION');
    return jsonBody(await request(id, { method: 'POST', query: { action: 'certificate', filename: safeFilename, expectedUpdatedAt, requestId: nonce }, body, contentType: mime, idempotencyId: nonce, signal }));
  }
  async function downloadAsset(id, kind, { signal } = {}) {
    if (!ASSET_KINDS.has(kind)) throw new RemoteReviewError('다운로드할 결과 자료를 확인해 주세요.', 400, 'INVALID_ASSET_KIND');
    const response = await request(id, { query: { asset: kind }, signal });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';
    const sizeHeader = response.headers.get('content-length'); const contentLength = sizeHeader === null ? null : Number(sizeHeader);
    if (!['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'].includes(contentType) || !response.body) { await response.body?.cancel(); throw new RemoteReviewError('결과 파일 형식을 확인할 수 없습니다.', 502, 'INVALID_ASSET_RESPONSE'); }
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > ASSET_LIMIT)) { await response.body.cancel(); throw new RemoteReviewError('결과 파일의 크기를 확인할 수 없습니다.', 502, 'ASSET_TOO_LARGE'); }
    let bytes = 0;
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > ASSET_LIMIT) { controller.error(new RemoteReviewError('결과 파일이 허용 크기를 초과했습니다.', 502, 'ASSET_TOO_LARGE')); return; } controller.enqueue(chunk); },
      flush(controller) { if (contentLength !== null && bytes !== contentLength) controller.error(new RemoteReviewError('결과 파일 다운로드가 완전하지 않습니다. 다시 시도해 주세요.', 502, 'ASSET_LENGTH_MISMATCH')); },
    }));
    const fallback = kind === 'ratingImage' ? '등급이미지.png' : kind === 'usageGuide' ? '등급표기_사용안내.pdf' : '영등위_필증.pdf';
    return { body, filename: filenameFromHeaders(response.headers, fallback), contentType, contentLength };
  }
  return { configured: () => !!configFor(env, options), health, getResults, getEmailPreview, saveResults, uploadCertificate, downloadAsset };
}
