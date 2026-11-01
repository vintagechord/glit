import { createHash } from 'node:crypto';
import dnsPromises from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';

/**
 * Site operations monitor for the review desk ("사이트 관리").
 * Checks the services Onside runs on — Vercel, Supabase, Backblaze B2 and the
 * Gabia-registered domain — and the plan headroom of each (Vercel Pro credit,
 * Supabase and B2 free tiers). All calls are read-only. Secrets never leave
 * this module in results.
 */
export const MONITOR_DEFAULTS = Object.freeze({
  domain: 'iamonside.com',
  wwwHost: 'www.iamonside.com',
  // Vercel A values known to serve this project. The ones Gabia had at the
  // cutover stay valid after the Pro upgrade; Vercel's current recommendation
  // (and whether the live records are accepted) comes from its domain API.
  acceptedA: ['216.198.79.1', '64.29.17.1', '216.150.1.1', '216.150.16.1'],
  expectedCname: '6dbbb6e9e0c47844.vercel-dns-017.com',
  vercelTeamId: 'team_WpvLGENQ2rt0S7kipCRKvIZK',
  vercelTeamSlug: 'vintagechord85-2949s-projects',
  vercelTeamName: "vintagechord85-2949's projects",
  vercelProjectId: 'prj_2BagpJ3xO4SYqS0taoYSdg2RlPRl',
  vercelProjectName: 'glit',
  limits: Object.freeze({
    b2FreeBytes: 10 * 1000 ** 3,
    supabaseDatabaseBytes: 500 * 1024 ** 2,
    supabaseStorageBytes: 1024 ** 3,
    supabaseMonthlyActiveUsers: 50_000,
    // Used only when Vercel's credit ledger is unavailable.
    vercelMonthlyCreditUsd: 20,
  }),
  // Known, accepted warnings from /api/health (e.g. optional Kakao alerts).
  benignHealthWarnings: Object.freeze(['kakao notification env']),
});

const TTL = { site: 60_000, domain: 10 * 60_000, rdap: 12 * 60 * 60_000, vercel: 5 * 60_000, vercelUsage: 30 * 60_000, supabase: 5 * 60_000, b2: 30 * 60_000 };
// B2 listing costs Class C transactions; manual refreshes are rate-limited.
const B2_MIN_FORCED_INTERVAL = 2 * 60_000;
// Vercel bills in daily buckets and the charge export grows to ~900 rows a day.
const VERCEL_USAGE_MIN_FORCED_INTERVAL = 5 * 60_000;
const RANK = { ok: 0, unknown: 1, warning: 2, error: 3 };
export const worst = statuses => statuses.reduce((current, next) => (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : current, 'ok');
const usageStatus = ratio => ratio >= 0.9 ? 'error' : ratio >= 0.7 ? 'warning' : 'ok';
const daysUntil = (date, now) => Math.floor((new Date(date).getTime() - now) / 86_400_000);
const bytesLabel = (n, base = 1000) => { n = Number(n) || 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= base && i < units.length - 1) { n /= base; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; };
const countLabel = n => Number(n || 0).toLocaleString('ko-KR');
const usd = n => `$${(Number(n) || 0).toFixed(2)}`;
const amountLabel = (n, unit, base) => unit === 'bytes' ? bytesLabel(n, base) : unit === 'usd' ? usd(n) : `${countLabel(n)}${unit === 'requests' ? '건' : '명'}`;
const kstDay = value => { const day = new Date(new Date(value).getTime() + 9 * 3_600_000); return `${day.getUTCMonth() + 1}월 ${day.getUTCDate()}일`; };
const kst = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const safeMessage = error => String(error?.message || error || '확인하지 못했습니다.').replace(/(?:eyJ[A-Za-z0-9_-]{10,}|Bearer\s+\S+|[A-Za-z0-9_-]{32,})/g, '***').slice(0, 200);
const usage = (label, used, limit, unit, note, base = 1000) => ({
  label, used, limit, unit, percent: limit ? Math.min(999, Math.round((used / limit) * 1000) / 10) : null,
  usedLabel: amountLabel(used, unit, base), limitLabel: amountLabel(limit, unit, base),
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

// Korean names for the Vercel services Onside uses; others keep Vercel's name.
const VERCEL_SERVICES = {
  'Fluid Active CPU': '함수 CPU', 'Function Invocations': '함수 실행', 'Fluid Provisioned Memory': '함수 메모리',
  'CDN Requests': 'CDN 요청', 'CDN Requests - Additional CPU Duration': 'CDN 추가 CPU', 'Fast Data Transfer': '데이터 전송', 'Fast Origin Transfer': '원본 전송',
  'Build CPU Minutes': '빌드', 'ISR Reads': 'ISR 읽기', 'ISR Writes': 'ISR 쓰기', 'Function Storage': '함수 저장 공간', 'Deployment Storage': '배포 저장 공간',
  'Observability Events': '로그·관측 이벤트', 'Image Optimization Transformation': '이미지 변환',
  'Image Optimization Cache Reads': '이미지 캐시 읽기', 'Image Optimization Cache Writes': '이미지 캐시 쓰기',
};
// Always listed when used, in this order; any other service shows once it costs a cent.
const VERCEL_KEY_SERVICES = ['Fluid Active CPU', 'Function Invocations', 'Fluid Provisioned Memory', 'CDN Requests', 'Fast Data Transfer', 'Fast Origin Transfer', 'Build CPU Minutes'];
const quantityLabel = (quantity, unit) => {
  const q = Number(quantity) || 0;
  switch (String(unit || '').toLowerCase()) {
    case 'gigabyte': return bytesLabel(q * 1e9);
    case 'hour': return q < 1 ? `${countLabel(Math.round(q * 600) / 10)}분` : `${countLabel(Math.round(q * 100) / 100)}시간`;
    case 'minute': return `${countLabel(Math.round(q))}분`;
    case 'gigabyte-hour': return `${countLabel(Math.round(q * 100) / 100)} GB·시간`;
    case 'requests': return `${countLabel(Math.round(q))}건`;
    default: return `${countLabel(Math.round(q))}회`;
  }
};

/**
 * Totals Vercel's FOCUS charge export (JSONL, one row per service, project and
 * day) for the whole team and for one project. EffectiveCost is what draws
 * down the Pro credit; BilledCost stays 0 until the credit runs out.
 */
export function summarizeVercelCharges(text, projectId) {
  const services = new Map(); const subscriptions = new Set(); let cost = 0, projectCost = 0, billed = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const name = row.ServiceName; if (!name) continue;
    // The plan fee and included tiers (Pro, Flat Rate CDN 1M, …) are licences, not usage.
    if (row.ServiceCategory === 'Subscription Licenses') { if (Number(row.ConsumedQuantity)) subscriptions.add(name); continue; }
    const quantity = Number(row.ConsumedQuantity) || 0, effective = Number(row.EffectiveCost) || 0;
    const entry = services.get(name) || { name, label: VERCEL_SERVICES[name] || name, unit: row.ConsumedUnit || '', quantity: 0, cost: 0, projectQuantity: 0, projectCost: 0 };
    entry.quantity += quantity; entry.cost += effective; cost += effective; billed += Number(row.BilledCost) || 0;
    if (row.Tags?.ProjectId === projectId) { entry.projectQuantity += quantity; entry.projectCost += effective; projectCost += effective; }
    services.set(name, entry);
  }
  return { services: [...services.values()].filter(entry => entry.quantity > 0).sort((a, b) => b.cost - a.cost || b.quantity - a.quantity), subscriptions: [...subscriptions], cost, projectCost, billed };
}

export function createSiteMonitor(options = {}) {
  const env = options.env || process.env;
  const config = { ...MONITOR_DEFAULTS, ...(options.config || {}) };
  const fetchImpl = options.fetch || globalThis.fetch;
  const dns = options.dns || dnsPromises;
  const tlsInfo = options.tlsInfo || defaultTlsInfo;
  const s3Factory = options.s3 || defaultS3;
  const now = options.now || Date.now;
  const getSettings = options.settings || (() => ({}));
  // Written by scripts/backup/onside-supabase-backup.mjs (launchd, 04:40 daily).
  const backupStatusFile = options.backupStatusFile || join(homedir(), 'OnsideBackups', 'last-status.json');
  const siteOrigin = (() => { try { return new URL(env.ONSIDE_DESK_SERVICE_URL || `https://${config.domain}`).origin; } catch { return `https://${config.domain}`; } })();
  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseRef = (() => { try { return new URL(supabaseUrl).hostname.split('.')[0]; } catch { return ''; } })();
  const cache = new Map();
  let lastB2Forced = 0;
  let lastVercelUsageForced = 0;
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
    // Vercel hands out A values from pools per plan, so several are valid at once.
    // A record is fine when it points only at Vercel and Vercel does not flag it.
    const vercel = vercelExpectations || { verified: {}, recommendedA: [], acceptedA: [], recommendedCname: '', acceptedCnames: [] };
    const acceptedA = new Set([...config.acceptedA, ...vercel.acceptedA]);
    const acceptedCnames = new Set([config.expectedCname, ...vercel.acceptedCnames]);
    try {
      const records = (await dns.resolve4(config.domain)).sort();
      const ok = records.length > 0 && records.every(ip => acceptedA.has(ip)) && vercel.verified[config.domain] !== false;
      const recommended = vercel.recommendedA;
      const isRecommended = recommended.length === records.length && recommended.every(ip => records.includes(ip));
      const hint = !ok ? `Vercel 주소가 아니거나 Vercel이 설정 오류로 표시합니다. 가비아 DNS의 대표(@) A 레코드를 ${(recommended.length ? recommended : config.acceptedA.slice(0, 2)).join(', ')}로 맞추세요.`
        : recommended.length && !isRecommended ? `Vercel이 지금 값도 정상으로 인식합니다. Vercel의 최신 권장값은 ${recommended.join(', ')}이며, 바꾸는 것은 선택입니다.` : '';
      items.push({ label: '대표 주소(A)', value: records.join(', '), status: ok ? 'ok' : 'error', ...(hint ? { hint } : {}) });
    } catch (error) { items.push({ label: '대표 주소(A)', value: safeMessage(error), status: 'error' }); }
    try {
      const cnames = (await dns.resolveCname(config.wwwHost)).map(name => name.replace(/\.$/, ''));
      const ok = cnames.some(name => acceptedCnames.has(name)) && vercel.verified[config.wwwHost] !== false;
      items.push({ label: 'www(CNAME)', value: cnames.join(', '), status: ok ? 'ok' : 'error', ...(ok ? {} : { hint: `Vercel 값 ${vercel.recommendedCname || config.expectedCname}와 다릅니다.` }) });
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

  async function vercelUsage(token) {
    // The credit ledger is what `vercel usage` (the official CLI) reads; the
    // charge export is the documented FOCUS endpoint. Both are team-level.
    const ledger = await vercelApi('/v1/invoices/pre-commitment-usage', token).catch(() => null);
    const credit = ledger?.status === 200 ? (ledger.body?.creditLedgers || []).find(entry => entry.currency === 'USD') || null : null;
    const current = new Date(now());
    const periodStart = new Date(credit?.periodStart || Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
    const periodEnd = new Date(credit?.periodEnd || Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
    // Charges come in whole-day buckets; a range shorter than one bucket returns 404.
    const to = new Date(Math.min(periodEnd.getTime(), Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 2)));
    const charges = await vercelApi(`/v1/billing/charges?from=${encodeURIComponent(periodStart.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, token);
    if (charges.status === 404 && charges.body?.error?.code === 'costs_not_found') return { periodStart, periodEnd, credit, services: [], subscriptions: [], cost: 0, projectCost: 0, billed: 0, empty: true };
    // A project-scoped token reaches deployments and domains but not team billing.
    if (charges.status !== 200) return { denied: [401, 403, 404].includes(charges.status), httpStatus: charges.status };
    return { periodStart, periodEnd, credit, ...summarizeVercelCharges(charges.text, config.vercelProjectId) };
  }

  function vercelUsageRows(bill, items, usageRows) {
    const label = '이번 달 사용량';
    if (bill.error) return items.push({ label, value: safeMessage(bill.error), status: 'warning' });
    if (bill.denied) return items.push({ label, value: '이 토큰으로는 팀 요금 정보를 볼 수 없습니다.', status: 'unknown', hint: `사용량은 팀 단위로 집계됩니다. Vercel ▶ Account Settings ▶ Tokens에서 Scope를 ${config.vercelTeamName} ▶ All Projects로 골라 만든 토큰으로 바꾸세요. 프로젝트 하나만 고른 토큰은 배포·도메인만 확인합니다.` });
    if (bill.httpStatus) return items.push({ label, value: `Vercel 응답 ${bill.httpStatus}`, status: 'warning' });
    const total = Number(bill.credit?.total ?? config.limits.vercelMonthlyCreditUsd);
    const used = bill.credit ? Math.max(0, total - Number(bill.credit.remaining ?? total)) : bill.cost;
    const ratio = total ? used / total : 0;
    // Going past the credit bills the excess; the site keeps running.
    usageRows.push({ ...usage(`Pro 월 크레딧 ($${Number.isInteger(total) ? total : total.toFixed(2)})`, used, total, 'usd', '같은 팀의 모든 프로젝트 합산입니다. 다 쓰면 넘은 만큼만 추가 청구되며, 75%가 되면 Vercel이 메일로 알립니다.'), status: ratio >= 1 ? 'error' : ratio >= 0.75 ? 'warning' : 'ok' });
    const tier = bill.subscriptions.map(name => /^Flat Rate CDN (\d+)M$/i.exec(name)).find(Boolean);
    if (tier) {
      const millions = Number(tier[1]);
      const quantity = name => bill.services.find(entry => entry.name === name)?.quantity || 0;
      usageRows.push(usage(`CDN 요청 (Flat Rate 월 ${countLabel(millions * 100)}만 건)`, quantity('CDN Requests'), millions * 1e6, 'requests', '넘으면 다음 결제 주기부터 한 단계 위 등급으로 바뀝니다. 하루 이틀 몰리는 것은 괜찮습니다.'));
      usageRows.push(usage(`데이터 전송 (Flat Rate 월 ${millions === 1 ? '1TB' : '50TB'})`, quantity('Fast Data Transfer') * 1e9, millions === 1 ? 1e12 : 50e12, 'bytes'));
    }
    items.push({ label: '결제 주기', value: bill.credit ? `${kstDay(bill.periodStart)} ~ ${kstDay(bill.periodEnd.getTime() - 1)}` : `${kstDay(bill.periodStart)}부터 집계 (Vercel 결제일과 다를 수 있음)`, status: 'ok' });
    // BilledCost is the part the credit no longer covers; rows carry float dust (~1e-11).
    const over = Math.round(Math.max(bill.billed, bill.credit ? 0 : bill.cost - total) * 100) / 100;
    items.push({ label: '크레딧 초과 사용', value: over ? `${usd(over)} · Pro 요금 외 추가 청구 예정` : '없음 (크레딧 안에서 사용 중)', status: over ? 'warning' : 'ok' });
    if (bill.empty) return items.push({ label, value: '아직 집계된 사용량이 없습니다.', status: 'ok' });
    items.push({ label: '온사이드 사용액', value: `${usd(bill.projectCost)} · 팀 전체 ${usd(bill.cost)}`, status: 'ok' });
    const listed = VERCEL_KEY_SERVICES.map(name => bill.services.find(entry => entry.name === name)).filter(Boolean)
      .concat(bill.services.filter(entry => !VERCEL_KEY_SERVICES.includes(entry.name) && entry.cost >= 0.01)).slice(0, 9);
    for (const entry of listed) items.push({ label: `이번 달 · ${entry.label}`, value: `온사이드 ${quantityLabel(entry.projectQuantity, entry.unit)} · 팀 ${quantityLabel(entry.quantity, entry.unit)}`, status: 'ok' });
  }

  async function checkVercel(force = false) {
    const links = [{ target: 'vercel-project', label: '프로젝트' }, { target: 'vercel-usage', label: '사용량' }];
    const token = getSettings().vercelToken;
    if (!token) {
      const result = section('vercel', 'Vercel (호스팅)', [{ label: '배포 상태', value: 'Vercel 토큰을 입력하면 확인합니다.', status: 'unknown' }], { status: 'unknown', links: [...links, { target: 'vercel-tokens', label: '토큰 만들기' }] });
      result.summary = '사이트 응답은 위 "온사이드 사이트"에서 확인합니다. 배포·도메인 상태와 사용량은 토큰이 필요합니다.';
      return result;
    }
    const items = []; const usageRows = [];
    try {
      const deployments = await vercelApi(`/v6/deployments?projectId=${config.vercelProjectId}&target=production&limit=5`, token);
      if (deployments.status === 401 || deployments.status === 403) throw Object.assign(new Error('토큰이 만료되었거나 이 팀에 권한이 없습니다.'), { auth: true });
      const list = deployments.body?.deployments || [];
      const latest = list[0];
      const live = list.find(item => (item.state || item.readyState) === 'READY');
      const state = latest ? latest.state || latest.readyState : 'NONE';
      items.push({ label: '최근 배포', value: latest ? `${state} · ${kst(latest.created)}${latest.meta?.githubCommitSha ? ` · ${latest.meta.githubCommitSha.slice(0, 7)}` : ''}` : '배포 없음', status: state === 'READY' || state === 'BUILDING' || state === 'QUEUED' || state === 'INITIALIZING' ? 'ok' : state === 'ERROR' ? 'warning' : 'unknown', ...(state === 'ERROR' ? { hint: '최근 배포가 실패했습니다. 사이트는 직전 성공 배포로 계속 운영됩니다.' } : {}) });
      if (live && live !== latest) items.push({ label: '운영 중인 배포', value: `${kst(live.created)}${live.meta?.githubCommitSha ? ` · ${live.meta.githubCommitSha.slice(0, 7)}` : ''}`, status: 'ok' });
      const verified = {}; const expectations = { verified, recommendedA: [], acceptedA: [], recommendedCname: '', acceptedCnames: [] };
      for (const host of [config.domain, config.wwwHost]) {
        const domainConfig = await vercelApi(`/v6/domains/${host}/config`, token);
        if (domainConfig.status !== 200 || !domainConfig.body) continue;
        verified[host] = domainConfig.body.misconfigured !== true;
        if (host !== config.domain) continue;
        const ranked = list => (Array.isArray(list) ? list : []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
        const ipv4 = ranked(domainConfig.body.recommendedIPv4), cnames = ranked(domainConfig.body.recommendedCNAME);
        expectations.recommendedA = (Array.isArray(ipv4[0]?.value) ? ipv4[0].value : []).slice().sort();
        expectations.acceptedA = ipv4.flatMap(entry => Array.isArray(entry.value) ? entry.value : [entry.value]).filter(Boolean);
        expectations.acceptedCnames = cnames.map(entry => String(entry.value || '').replace(/\.$/, '')).filter(Boolean);
        expectations.recommendedCname = expectations.acceptedCnames[0] || '';
      }
      if (Object.keys(verified).length) {
        vercelExpectations = expectations;
        const broken = Object.keys(verified).filter(host => !verified[host]);
        items.push({ label: '도메인 연결', value: broken.length ? `설정 오류 · ${broken.join(', ')}` : '정상', status: broken.length ? 'error' : 'ok' });
      }
      const forceUsage = force && now() - lastVercelUsageForced >= VERCEL_USAGE_MIN_FORCED_INTERVAL;
      if (forceUsage) lastVercelUsageForced = now();
      // Keyed by token so a replaced token is checked at once.
      const usageKey = `vercel-usage:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
      vercelUsageRows(await cached(usageKey, TTL.vercelUsage, forceUsage, () => vercelUsage(token)).catch(error => ({ error })), items, usageRows);
    } catch (error) {
      items.push({ label: 'Vercel API', value: safeMessage(error), status: error?.auth ? 'error' : 'warning' });
    }
    const result = section('vercel', 'Vercel (호스팅)', items, { usage: usageRows, links });
    result.summary = result.status === 'ok' ? (usageRows.length ? 'Production 배포와 도메인 연결이 정상이고, 이번 달 사용량이 Pro 크레딧 안에 있습니다.' : 'Production 배포와 도메인 연결이 정상입니다.')
      : usageRows.some(row => row.status !== 'ok') ? 'Pro 크레딧이나 CDN 한도에 가까워졌습니다. 사용량을 확인하세요.' : '배포 또는 도메인 연결을 확인하세요.';
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
    try {
      const backup = JSON.parse(await readFile(backupStatusFile, 'utf8'));
      const ageHours = (now() - new Date(backup.finishedAt || backup.startedAt).getTime()) / 3_600_000;
      items.push(backup.ok
        ? { label: 'DB 자동 백업', value: `${kst(backup.finishedAt)} 성공 · ${bytesLabel(backup.database?.bytes)}`, status: ageHours > 26 ? 'warning' : 'ok', ...(ageHours > 26 ? { hint: '하루 넘게 백업이 없습니다. Mac이 꺼져 있었는지 확인하세요.' } : {}) }
        : { label: 'DB 자동 백업', value: `${kst(backup.finishedAt)} 실패 · ${backup.error || '원인 미상'}`, status: 'warning', hint: '~/OnsideBackups/logs/backup.log를 확인하세요.' });
    } catch {
      items.push({ label: 'DB 자동 백업', value: '설정되지 않았습니다 (scripts/backup/README.md).', status: 'warning' });
    }
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
    const vercel = await guard('vercel', 'Vercel (호스팅)', cached('vercel', TTL.vercel, force, () => checkVercel(force)));
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
