import dnsPromises from 'node:dns/promises';
import tls from 'node:tls';

/**
 * Site operations monitor for the review desk ("사이트 관리").
 * Checks the services Onside runs on — Vercel, Supabase, Backblaze B2 and the
 * Gabia-registered domain — and the free-plan headroom of each. All calls are
 * read-only. Secrets never leave this module in results.
 */
export const MONITOR_DEFAULTS = Object.freeze({
  domain: 'iamonside.com',
  wwwHost: 'www.iamonside.com',
  expectedA: ['216.198.79.1', '64.29.17.1'],
  expectedCname: '6dbbb6e9e0c47844.vercel-dns-017.com',
  vercelTeamId: 'team_WpvLGENQ2rt0S7kipCRKvIZK',
  vercelTeamSlug: 'vintagechord85-2949s-projects',
  vercelProjectId: 'prj_2BagpJ3xO4SYqS0taoYSdg2RlPRl',
  vercelProjectName: 'glit',
  limits: Object.freeze({
    b2FreeBytes: 10 * 1000 ** 3,
    supabaseDatabaseBytes: 500 * 1024 ** 2,
    supabaseStorageBytes: 1024 ** 3,
    supabaseMonthlyActiveUsers: 50_000,
  }),
  // Known, accepted warnings from /api/health (e.g. optional Kakao alerts).
  benignHealthWarnings: Object.freeze(['kakao notification env']),
});

const TTL = { site: 60_000, domain: 10 * 60_000, rdap: 12 * 60 * 60_000, vercel: 5 * 60_000, supabase: 5 * 60_000, b2: 30 * 60_000 };
// B2 listing costs Class C transactions; manual refreshes are rate-limited.
const B2_MIN_FORCED_INTERVAL = 2 * 60_000;
const RANK = { ok: 0, unknown: 1, warning: 2, error: 3 };
export const worst = statuses => statuses.reduce((current, next) => (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : current, 'ok');
const usageStatus = ratio => ratio >= 0.9 ? 'error' : ratio >= 0.7 ? 'warning' : 'ok';
const daysUntil = (date, now) => Math.floor((new Date(date).getTime() - now) / 86_400_000);
const bytesLabel = (n, base = 1000) => { n = Number(n) || 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= base && i < units.length - 1) { n /= base; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; };
const countLabel = n => Number(n || 0).toLocaleString('ko-KR');
const kst = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const safeMessage = error => String(error?.message || error || '확인하지 못했습니다.').replace(/(?:eyJ[A-Za-z0-9_-]{10,}|Bearer\s+\S+|[A-Za-z0-9_-]{32,})/g, '***').slice(0, 200);
const usage = (label, used, limit, unit, note, base = 1000) => ({
  label, used, limit, unit, percent: limit ? Math.min(999, Math.round((used / limit) * 1000) / 10) : null,
  usedLabel: unit === 'bytes' ? bytesLabel(used, base) : `${countLabel(used)}명`, limitLabel: unit === 'bytes' ? bytesLabel(limit, base) : `${countLabel(limit)}명`,
  status: limit ? usageStatus(used / limit) : 'ok', ...(note ? { note } : {}),
});

function section(id, title, items = [], extra = {}) {
  const { status: forced, ...rest } = extra;
  // "unknown" rows are informational (e.g. not available by API) unless nothing else was checked.
  const checked = items.map(item => item.status || 'ok').concat((rest.usage || []).map(entry => entry.status)).filter(value => value !== 'unknown');
  const status = forced || (checked.length ? worst(checked) : 'unknown');
  return { id, title, checkedAt: new Date().toISOString(), items, usage: [], links: [], ...rest, status };
}

async function timedFetch(fetchImpl, url, options = {}, timeoutMs = 15_000) {
  const started = Date.now();
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'manual', ...options, signal: AbortSignal.timeout(timeoutMs) });
  return { response, ms: Date.now() - started };
}

export function defaultTlsInfo(host, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return reject(new Error('인증서를 읽지 못했습니다.'));
      resolve({ validTo: new Date(cert.valid_to).toISOString(), issuer: cert.issuer?.O || cert.issuer?.CN || '' });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('TLS 연결 시간이 초과되었습니다.')); });
    socket.on('error', reject);
  });
}

async function defaultS3(env) {
  const { S3Client, ListObjectsV2Command, ListMultipartUploadsCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: env.B2_REGION, endpoint: env.B2_S3_ENDPOINT, credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY } });
  return {
    async listObjects(prefix, maxPages = 20) {
      const objects = []; let token; let pages = 0;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: env.B2_BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(30_000) });
        for (const item of page.Contents || []) objects.push({ key: item.Key, size: Number(item.Size) || 0, lastModified: item.LastModified ? new Date(item.LastModified).toISOString() : null });
        token = page.IsTruncated ? page.NextContinuationToken : undefined; pages++;
      } while (token && pages < maxPages);
      return { objects, truncated: Boolean(token) };
    },
    async listUnfinished(prefix) {
      const page = await client.send(new ListMultipartUploadsCommand({ Bucket: env.B2_BUCKET, Prefix: prefix }), { abortSignal: AbortSignal.timeout(30_000) });
      return (page.Uploads || []).map(item => ({ key: item.Key, initiated: item.Initiated ? new Date(item.Initiated).toISOString() : null }));
    },
  };
}

const VIDEO = /\.(mp4|mov|wmv|mpg|mpeg|m4v|avi|mkv)$/i, AUDIO = /\.(wav|mp3|flac|aif|aiff|m4a|zip)$/i, DOCS = /\.(pdf|doc|docx|hwp|txt|xlsx|xls)$/i, IMAGES = /\.(jpe?g|png|webp|gif)$/i;
export const fileCategory = key => VIDEO.test(key) ? '영상' : AUDIO.test(key) ? '음원' : DOCS.test(key) ? '문서' : IMAGES.test(key) ? '이미지' : '기타';

export function createSiteMonitor(options = {}) {
  const env = options.env || process.env;
  const config = { ...MONITOR_DEFAULTS, ...(options.config || {}) };
  const fetchImpl = options.fetch || globalThis.fetch;
  const dns = options.dns || dnsPromises;
  const tlsInfo = options.tlsInfo || defaultTlsInfo;
  const s3Factory = options.s3 || defaultS3;
  const now = options.now || Date.now;
  const getSettings = options.settings || (() => ({}));
  const siteOrigin = (() => { try { return new URL(env.ONSIDE_DESK_SERVICE_URL || `https://${config.domain}`).origin; } catch { return `https://${config.domain}`; } })();
  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseRef = (() => { try { return new URL(supabaseUrl).hostname.split('.')[0]; } catch { return ''; } })();
  const cache = new Map();
  let lastB2Forced = 0;
  let vercelExpectations = null;

  async function cached(key, ttl, force, run) {
    const entry = cache.get(key);
    if (!force && entry && entry.expires > now()) return entry.promise;
    const fresh = { expires: now() + ttl, promise: Promise.resolve().then(run) };
    cache.set(key, fresh);
    // A failed check is retried sooner, but not on every poll.
    fresh.promise.then(result => { if (result?.status === 'error') fresh.expires = Math.min(fresh.expires, now() + 60_000); }, () => { fresh.expires = 0; });
    return fresh.promise;
  }

  async function checkSite() {
    const items = [];
    try {
      const { response, ms } = await timedFetch(fetchImpl, `${siteOrigin}/api/health`);
      const body = await response.json().catch(() => null);
      const failing = (body?.checks || []).filter(check => !check.ok);
      const errors = failing.filter(check => check.severity === 'error').map(check => check.name);
      const warnings = failing.filter(check => check.severity !== 'error').map(check => check.name);
      const realWarnings = warnings.filter(name => !config.benignHealthWarnings.includes(name));
      items.push({ label: '사이트 응답', value: `${response.status} · ${ms}ms`, status: !response.ok || !body ? 'error' : ms > 4000 ? 'warning' : 'ok' });
      items.push({ label: '서버 상태 점검', value: errors.length ? `오류 ${errors.join(', ')}` : realWarnings.length ? `주의 ${realWarnings.join(', ')}` : warnings.length ? `정상 (선택 항목: ${warnings.join(', ')})` : '정상', status: errors.length ? 'error' : realWarnings.length ? 'warning' : 'ok' });
    } catch (error) {
      items.push({ label: '사이트 응답', value: `응답 없음 · ${safeMessage(error)}`, status: 'error' });
    }
    try {
      const { response } = await timedFetch(fetchImpl, `https://${config.wwwHost}/`, { method: 'HEAD' });
      const location = response.headers.get('location') || '';
      const redirects = [301, 302, 307, 308].includes(response.status) && new URL(location, `https://${config.wwwHost}`).hostname === config.domain;
      items.push({ label: 'www 주소', value: redirects ? `${config.domain}로 연결` : `응답 ${response.status}`, status: redirects ? 'ok' : 'warning' });
    } catch (error) {
      items.push({ label: 'www 주소', value: safeMessage(error), status: 'warning' });
    }
    const result = section('site', '온사이드 사이트', items, { links: [{ target: 'site', label: '사이트 열기' }] });
    result.summary = result.status === 'ok' ? '고객이 사이트를 정상적으로 이용할 수 있습니다.' : result.status === 'warning' ? '사이트는 열리지만 확인할 항목이 있습니다.' : '사이트에 접속하지 못하거나 서버 오류가 있습니다.';
    return result;
  }

  async function domainExpiry(force) {
    return cached('rdap', TTL.rdap, force, async () => {
      const { response } = await timedFetch(fetchImpl, `https://rdap.verisign.com/com/v1/domain/${config.domain}`, { headers: { Accept: 'application/rdap+json' }, redirect: 'follow' });
      if (!response.ok) throw new Error(`도메인 정보 응답 ${response.status}`);
      const body = await response.json();
      const expiration = (body.events || []).find(event => event.eventAction === 'expiration')?.eventDate;
      const registrar = (body.entities || []).find(entity => (entity.roles || []).includes('registrar'))?.vcardArray?.[1]?.find(field => field[0] === 'fn')?.[3] || '';
      if (!expiration) throw new Error('도메인 만료일이 없습니다.');
      return { expiration, registrar };
    });
  }

  async function checkDomain(force) {
    const items = [];
    const expected = vercelExpectations || { a: config.expectedA, cname: config.expectedCname };
    try {
      const records = (await dns.resolve4(config.domain)).sort();
      const match = expected.a.every(ip => records.includes(ip)) && records.every(ip => expected.a.includes(ip));
      items.push({ label: '대표 주소(A)', value: records.join(', '), status: match ? 'ok' : 'error', ...(match ? {} : { hint: `Vercel 값 ${expected.a.join(', ')}와 다릅니다. 가비아 DNS를 확인하세요.` }) });
    } catch (error) { items.push({ label: '대표 주소(A)', value: safeMessage(error), status: 'error' }); }
    try {
      const cnames = (await dns.resolveCname(config.wwwHost)).map(name => name.replace(/\.$/, ''));
      const match = cnames.includes(expected.cname);
      items.push({ label: 'www(CNAME)', value: cnames.join(', '), status: match ? 'ok' : 'error', ...(match ? {} : { hint: `Vercel 값 ${expected.cname}와 다릅니다.` }) });
    } catch (error) { items.push({ label: 'www(CNAME)', value: safeMessage(error), status: 'error' }); }
    try {
      const ns = await dns.resolveNs(config.domain);
      const gabia = ns.some(name => /gabia/i.test(name));
      items.push({ label: '네임서버', value: gabia ? '가비아' : ns.join(', '), status: gabia ? 'ok' : 'warning' });
    } catch (error) { items.push({ label: '네임서버', value: safeMessage(error), status: 'warning' }); }
    for (const host of [config.domain, config.wwwHost]) {
      try {
        const cert = await tlsInfo(host);
        const days = daysUntil(cert.validTo, now());
        items.push({ label: `SSL ${host === config.domain ? '대표' : 'www'}`, value: `${days}일 남음 (${cert.validTo.slice(0, 10)})`, status: days < 7 ? 'error' : days < 20 ? 'warning' : 'ok', ...(days < 20 ? { hint: 'Vercel이 자동 갱신하지 못하고 있습니다. DNS 설정을 확인하세요.' } : {}) });
      } catch (error) { items.push({ label: `SSL ${host === config.domain ? '대표' : 'www'}`, value: safeMessage(error), status: 'error' }); }
    }
    try {
      const info = await domainExpiry(force);
      const days = daysUntil(info.expiration, now());
      items.push({ label: '도메인 만료', value: `${days}일 남음 (${info.expiration.slice(0, 10)})`, status: days < 30 ? 'error' : days < 60 ? 'warning' : 'ok', ...(days < 60 ? { hint: '가비아에서 기간 연장(또는 자동연장)을 확인하세요.' } : {}) });
    } catch (error) { items.push({ label: '도메인 만료', value: safeMessage(error), status: 'unknown' }); }
    const result = section('domain', '가비아 도메인 · DNS', items, { links: [{ target: 'gabia', label: '가비아 열기' }] });
    result.summary = result.status === 'ok' ? `${config.domain}가 Vercel을 가리키고 인증서·도메인 기간이 충분합니다.` : '도메인·DNS·인증서 중 확인할 항목이 있습니다.';
    return result;
  }

  async function vercelApi(path, token) {
    const separator = path.includes('?') ? '&' : '?';
    const { response } = await timedFetch(fetchImpl, `https://api.vercel.com${path}${separator}teamId=${config.vercelTeamId}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
    const text = await response.text();
    let body = null; try { body = JSON.parse(text); } catch { body = null; }
    return { status: response.status, body, text };
  }

  async function checkVercel() {
    const links = [{ target: 'vercel-project', label: '프로젝트' }, { target: 'vercel-usage', label: '사용량' }];
    const token = getSettings().vercelToken;
    if (!token) {
      const result = section('vercel', 'Vercel (호스팅)', [{ label: '배포 상태', value: 'Vercel 토큰을 입력하면 확인합니다.', status: 'unknown' }], { status: 'unknown', links: [...links, { target: 'vercel-tokens', label: '토큰 만들기' }] });
      result.summary = '사이트 응답은 위 "온사이드 사이트"에서 확인합니다. 배포·도메인 상태는 토큰이 필요합니다.';
      return result;
    }
    const items = [];
    try {
      const deployments = await vercelApi(`/v6/deployments?projectId=${config.vercelProjectId}&target=production&limit=5`, token);
      if (deployments.status === 401 || deployments.status === 403) throw Object.assign(new Error('토큰이 만료되었거나 이 팀에 권한이 없습니다.'), { auth: true });
      const list = deployments.body?.deployments || [];
      const latest = list[0];
      const live = list.find(item => (item.state || item.readyState) === 'READY');
      const state = latest ? latest.state || latest.readyState : 'NONE';
      items.push({ label: '최근 배포', value: latest ? `${state} · ${kst(latest.created)}${latest.meta?.githubCommitSha ? ` · ${latest.meta.githubCommitSha.slice(0, 7)}` : ''}` : '배포 없음', status: state === 'READY' || state === 'BUILDING' || state === 'QUEUED' || state === 'INITIALIZING' ? 'ok' : state === 'ERROR' ? 'warning' : 'unknown', ...(state === 'ERROR' ? { hint: '최근 배포가 실패했습니다. 사이트는 직전 성공 배포로 계속 운영됩니다.' } : {}) });
      if (live && live !== latest) items.push({ label: '운영 중인 배포', value: `${kst(live.created)}${live.meta?.githubCommitSha ? ` · ${live.meta.githubCommitSha.slice(0, 7)}` : ''}`, status: 'ok' });
      const domainConfig = await vercelApi(`/v6/domains/${config.domain}/config`, token);
      if (domainConfig.body) {
        const misconfigured = domainConfig.body.misconfigured === true;
        items.push({ label: '도메인 연결', value: misconfigured ? '설정 오류' : '정상', status: misconfigured ? 'error' : 'ok' });
        const a = domainConfig.body.recommendedIPv4?.[0]?.value; const cname = domainConfig.body.recommendedCNAME?.[0]?.value;
        if (Array.isArray(a) && a.length && typeof cname === 'string') vercelExpectations = { a: a.slice().sort(), cname: cname.replace(/\.$/, '') };
      }
      const monthStart = new Date(new Date(now()).toISOString().slice(0, 8) + '01T00:00:00Z');
      const charges = await vercelApi(`/v1/billing/charges?from=${encodeURIComponent(monthStart.toISOString())}&to=${encodeURIComponent(new Date(now()).toISOString())}`, token).catch(() => null);
      const totals = new Map();
      if (charges?.status === 200) {
        for (const line of charges.text.split('\n')) {
          try {
            const row = JSON.parse(line);
            const name = row.ServiceName || row.ChargeDescription; const quantity = Number(row.ConsumedQuantity);
            if (name && Number.isFinite(quantity)) { const entry = totals.get(name) || { quantity: 0, unit: row.ConsumedUnit || '' }; entry.quantity += quantity; totals.set(name, entry); }
          } catch { /* skip non-JSON lines */ }
        }
      }
      if (totals.size) for (const [name, entry] of [...totals].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 8)) items.push({ label: `이번 달 · ${name}`, value: `${countLabel(Math.round(entry.quantity * 100) / 100)} ${entry.unit}`.trim(), status: 'ok' });
      else items.push({ label: '이번 달 사용량', value: 'Hobby 사용량은 API로 제공되지 않습니다. "사용량" 버튼으로 확인하세요.', status: 'unknown' });
    } catch (error) {
      items.push({ label: 'Vercel API', value: safeMessage(error), status: error?.auth ? 'error' : 'warning' });
    }
    const result = section('vercel', 'Vercel (호스팅)', items, { links });
    result.summary = result.status === 'ok' ? 'Production 배포와 도메인 연결이 정상입니다.' : '배포 또는 도메인 연결을 확인하세요.';
    return result;
  }

  async function checkSupabase() {
    const links = [{ target: 'supabase-project', label: '대시보드' }];
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !key) return { ...section('supabase', 'Supabase (DB · 로그인)', [{ label: '연결 정보', value: '데스크 연결 정보가 없습니다.', status: 'error' }]), links, summary: '연결 정보를 확인하세요.' };
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const items = []; const usageRows = [];
    for (const [label, path] of [['로그인(Auth)', '/auth/v1/health'], ['파일 저장소(Storage)', '/storage/v1/bucket']]) {
      try {
        const { response, ms } = await timedFetch(fetchImpl, `${supabaseUrl}${path}`, { headers, redirect: 'error' });
        items.push({ label, value: `${response.status} · ${ms}ms`, status: response.ok ? (ms > 4000 ? 'warning' : 'ok') : 'error' });
      } catch (error) { items.push({ label, value: safeMessage(error), status: 'error' }); }
    }
    try {
      const { response, ms } = await timedFetch(fetchImpl, `${supabaseUrl}/rest/v1/rpc/site_monitoring_snapshot`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', redirect: 'error' }, 20_000);
      const body = await response.json().catch(() => null);
      if (response.status === 404 || body?.code === 'PGRST202') {
        items.push({ label: '데이터베이스', value: '점검 함수가 없습니다. supabase db push로 마이그레이션 20261101120000을 적용하세요.', status: 'warning' });
      } else if (!response.ok || !body) {
        items.push({ label: '데이터베이스', value: `응답 ${response.status}`, status: 'error' });
      } else {
        items.push({ label: '데이터베이스', value: `정상 · ${ms}ms`, status: 'ok' });
        const storageBytes = (body.storageBuckets || []).reduce((sum, bucket) => sum + Number(bucket.bytes || 0), 0);
        usageRows.push(usage('DB 용량 (무료 500MB)', Number(body.databaseBytes || 0), config.limits.supabaseDatabaseBytes, 'bytes', undefined, 1024));
        usageRows.push(usage('Storage 용량 (무료 1GB)', storageBytes, config.limits.supabaseStorageBytes, 'bytes', '배너·매거진 이미지 등. 심의 파일은 Backblaze에 저장됩니다.', 1024));
        usageRows.push(usage('이번 달 로그인 회원 (무료 5만 명)', Number(body.monthlyActiveUsers || 0), config.limits.supabaseMonthlyActiveUsers, 'count', `전체 회원 ${countLabel(body.authUsers)}명`));
        const worker = body.emailWorker || {};
        const workerAge = worker.lastFinishedAt ? (now() - new Date(worker.lastFinishedAt).getTime()) / 3_600_000 : Infinity;
        items.push({ label: '메일 발송 작업', value: worker.lastError ? '마지막 실행 실패' : `마지막 실행 ${kst(worker.lastFinishedAt)}`, status: worker.lastError || workerAge > 26 ? 'warning' : 'ok' });
        const outbox = body.emailOutbox || {}; const stuck = Number(outbox.failed || 0) + Number(outbox.uncertain || 0);
        items.push({ label: '메일 실패·확인 필요(30일)', value: `${countLabel(stuck)}건`, status: stuck ? 'warning' : 'ok', ...(stuck ? { hint: '관리자 > 메일 발송 화면에서 확인하세요.' } : {}) });
        if (body.cron) items.push({ label: '예약 작업(pg_cron) 실패(24시간)', value: `${countLabel(body.cron.failedLast24h)}건`, status: body.cron.failedLast24h ? 'warning' : 'ok' });
        if (body.net && body.net.totalLast6h) items.push({ label: '앱 호출 실패(6시간)', value: `${countLabel(body.net.failedLast6h)} / ${countLabel(body.net.totalLast6h)}건`, status: body.net.failedLast6h / body.net.totalLast6h > 0.2 ? 'warning' : 'ok' });
        const receipts = body.cashReceipts || {};
        items.push({ label: '현금영수증 대기', value: `발급 대기 ${countLabel(receipts.REQUESTED)}건 · 확인 필요 ${countLabel(receipts.FAILED)}건`, status: receipts.FAILED ? 'warning' : 'ok' });
        items.push({ label: '입금 대기 주문', value: `${countLabel(body.pendingBankOrders)}건`, status: 'ok' });
        const failedJobs = Number(body.musicArchiveJobs?.failed || 0) + Number(body.reviewDocumentJobs?.failed || 0);
        if (failedJobs) items.push({ label: '백그라운드 작업 실패', value: `${countLabel(failedJobs)}건`, status: 'warning' });
        const idleDays = body.latestActivityAt ? (now() - new Date(body.latestActivityAt).getTime()) / 86_400_000 : 0;
        if (idleDays > 5) items.push({ label: '무료 프로젝트 일시정지 위험', value: `${Math.floor(idleDays)}일간 활동 없음`, status: 'warning', hint: '무료 프로젝트는 1주일간 활동이 없으면 일시정지됩니다.' });
      }
    } catch (error) { items.push({ label: '데이터베이스', value: safeMessage(error), status: 'error' }); }
    items.push({ label: '전송량·Egress', value: '무료 5GB/월 — API로 제공되지 않아 대시보드에서 확인', status: 'unknown' });
    const result = section('supabase', 'Supabase (DB · 로그인)', items, { usage: usageRows, links });
    result.status = worst([result.status === 'unknown' ? 'ok' : result.status, ...usageRows.map(row => row.status)]);
    result.summary = result.status === 'ok' ? '데이터베이스·로그인·저장소가 정상이고 무료 한도 안에 있습니다.' : usageRows.some(row => row.status !== 'ok') ? '무료 한도에 가까워졌습니다. 업그레이드나 정리가 필요합니다.' : '확인할 항목이 있습니다.';
    return result;
  }

  async function checkB2() {
    const links = [{ target: 'b2-buckets', label: '버킷' }, { target: 'b2-caps', label: 'Caps & Alerts' }];
    if (!env.B2_BUCKET || !env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_S3_ENDPOINT) return { ...section('b2', 'Backblaze B2 (파일 저장소)', [{ label: '연결 정보', value: '데스크 연결 정보에 B2 키가 없습니다.', status: 'error' }]), links, summary: '연결 정보를 확인하세요.' };
    const prefix = env.B2_PREFIX || 'submissions/';
    const items = []; const usageRows = []; const details = {};
    try {
      const s3 = await s3Factory(env);
      const { objects, truncated } = await s3.listObjects(prefix);
      const total = objects.reduce((sum, object) => sum + object.size, 0);
      usageRows.push(usage('저장 용량 (무료 10GB)', total, config.limits.b2FreeBytes, 'bytes', '10GB를 넘으면 결제 수단 등록이 필요하고 TB당 월 약 6달러가 청구됩니다.'));
      items.push({ label: '저장 파일', value: `${countLabel(objects.length)}개 · ${bytesLabel(total)}${truncated ? ' 이상(일부만 집계)' : ''}`, status: 'ok' });
      const categories = new Map();
      for (const object of objects) { const name = fileCategory(object.key); const entry = categories.get(name) || { count: 0, bytes: 0 }; entry.count++; entry.bytes += object.size; categories.set(name, entry); }
      details.categories = [...categories].map(([name, entry]) => ({ name, ...entry })).sort((a, b) => b.bytes - a.bytes);
      // Upload keys start with a UUID; show the customer's file name.
      details.largest = objects.slice().sort((a, b) => b.size - a.size).slice(0, 5).map(object => ({ name: object.key.split('/').pop().replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i, ''), size: object.size, lastModified: object.lastModified, category: fileCategory(object.key) }));
      const aged = objects.filter(object => object.lastModified && now() - new Date(object.lastModified).getTime() > 180 * 86_400_000);
      details.aged = { count: aged.length, bytes: aged.reduce((sum, object) => sum + object.size, 0), videoBytes: aged.filter(object => VIDEO.test(object.key)).reduce((sum, object) => sum + object.size, 0) };
      items.push({ label: '180일 지난 파일', value: `${countLabel(aged.length)}개 · ${bytesLabel(details.aged.bytes)} (영상 ${bytesLabel(details.aged.videoBytes)})`, status: 'ok' });
      const unfinished = await s3.listUnfinished(prefix);
      const stale = unfinished.filter(upload => upload.initiated && now() - new Date(upload.initiated).getTime() > 86_400_000);
      details.unfinished = { count: unfinished.length, stale: stale.length };
      items.push({ label: '미완료 업로드', value: `${countLabel(unfinished.length)}건${stale.length ? ` (하루 지난 ${stale.length}건)` : ''}`, status: stale.length ? 'warning' : 'ok', ...(stale.length ? { hint: '중단된 대용량 업로드 조각이 용량을 차지합니다. B2 버킷에서 정리하세요.' } : {}) });
    } catch (error) {
      items.push({ label: '버킷 조회', value: safeMessage(error), status: 'error' });
    }
    items.push({ label: '결제 수단 · 한도', value: 'API로 확인할 수 없습니다. "Caps & Alerts"에서 확인하세요.', status: 'unknown' });
    const result = section('b2', 'Backblaze B2 (파일 저장소)', items, { usage: usageRows, links, details });
    result.status = worst([result.status === 'unknown' ? 'ok' : result.status, ...usageRows.map(row => row.status)]);
    result.summary = result.status === 'ok' ? '파일 저장소가 정상이고 무료 용량 안에 있습니다.' : usageRows.some(row => row.status !== 'ok') ? '무료 10GB에 가까워졌습니다. 오래된 영상 정리나 결제 수단 등록이 필요합니다.' : '파일 저장소에서 확인할 항목이 있습니다.';
    return result;
  }

  async function snapshot(force = false) {
    const forceB2 = force && now() - lastB2Forced >= B2_MIN_FORCED_INTERVAL;
    if (forceB2) lastB2Forced = now();
    const guard = (id, title, promise) => promise.catch(error => ({ ...section(id, title, [{ label: '점검', value: safeMessage(error), status: 'error' }]), summary: '점검 중 오류가 발생했습니다.' }));
    const vercel = await guard('vercel', 'Vercel (호스팅)', cached('vercel', TTL.vercel, force, checkVercel));
    const sections = await Promise.all([
      guard('site', '온사이드 사이트', cached('site', TTL.site, force, checkSite)),
      Promise.resolve(vercel),
      guard('supabase', 'Supabase (DB · 로그인)', cached('supabase', TTL.supabase, force, checkSupabase)),
      guard('b2', 'Backblaze B2 (파일 저장소)', cached('b2', TTL.b2, forceB2, checkB2)),
      guard('domain', '가비아 도메인 · DNS', cached('domain', TTL.domain, force, () => checkDomain(force))),
    ]);
    const overall = worst(sections.map(item => item.status === 'unknown' ? 'ok' : item.status));
    const issues = sections.flatMap(item => item.items.filter(entry => entry.status === 'warning' || entry.status === 'error').map(entry => ({ section: item.title, label: entry.label, status: entry.status })))
      .concat(sections.flatMap(item => (item.usage || []).filter(entry => entry.status !== 'ok').map(entry => ({ section: item.title, label: entry.label, status: entry.status }))));
    return { checkedAt: new Date(now()).toISOString(), overall, issues, sections };
  }

  const links = () => ({
    site: siteOrigin,
    gabia: 'https://www.gabia.com/',
    'vercel-project': `https://vercel.com/${config.vercelTeamSlug}/${config.vercelProjectName}`,
    'vercel-usage': `https://vercel.com/${config.vercelTeamSlug}/~/usage`,
    'vercel-tokens': 'https://vercel.com/account/settings/tokens',
    'supabase-project': supabaseRef ? `https://supabase.com/dashboard/project/${supabaseRef}` : 'https://supabase.com/dashboard/projects',
    'b2-buckets': 'https://secure.backblaze.com/b2_buckets.htm',
    'b2-caps': 'https://secure.backblaze.com/b2_caps_alerts.htm',
  });

  return { snapshot, links };
}

/** One-line macOS notification text for a degraded snapshot. */
export function notificationText(snapshot) {
  const issues = snapshot.issues.filter(issue => issue.status === 'error').concat(snapshot.issues.filter(issue => issue.status === 'warning'));
  if (!issues.length) return '';
  const first = issues[0];
  return `${first.section}: ${first.label}${issues.length > 1 ? ` 외 ${issues.length - 1}건` : ''}`;
}
