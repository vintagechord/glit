import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSiteMonitor, fileCategory, notificationText, worst } from '../monitor.mjs';
import { createDesk } from '../server.mjs';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const env = {
  ONSIDE_DESK_SERVICE_URL: 'https://iamonside.com', NEXT_PUBLIC_SUPABASE_URL: 'https://ref123.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  B2_BUCKET: 'bucket', B2_KEY_ID: 'key', B2_APPLICATION_KEY: 'secret', B2_S3_ENDPOINT: 'https://s3.example.invalid', B2_REGION: 'r', B2_PREFIX: 'submissions/',
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakes(overrides = {}) {
  const calls = [];
  const snapshot = { databaseBytes: 50 * 1024 ** 2, storageBuckets: [{ bucket: 'banners', objects: 2, bytes: 900 * 1024 ** 2 }], authUsers: 10, monthlyActiveUsers: 3,
    latestActivityAt: '2026-10-31T00:00:00Z', emailOutbox: { accepted: 4 }, emailWorker: { lastFinishedAt: '2026-10-31T23:00:00Z', lastError: false },
    cashReceipts: { REQUESTED: 1 }, pendingBankOrders: 2, cron: { failedLast24h: 0 }, net: { failedLast6h: 0, totalLast6h: 4 }, ...overrides.snapshot };
  const fetch = async (url, init = {}) => {
    calls.push(String(url));
    const target = new URL(url);
    if (target.pathname === '/api/health') return overrides.siteDown ? Promise.reject(new Error('connect ECONNREFUSED')) : json({ ok: true, checks: [{ name: 'kakao notification env', ok: false, severity: 'warning' }] });
    if (target.hostname === 'www.iamonside.com') return new Response(null, { status: 308, headers: { location: 'https://iamonside.com/' } });
    if (target.hostname === 'rdap.verisign.com') return json({ events: [{ eventAction: 'expiration', eventDate: overrides.domainExpiry || '2029-10-28T00:00:00Z' }] });
    if (target.pathname === '/rest/v1/rpc/site_monitoring_snapshot') return overrides.noRpc ? json({ code: 'PGRST202' }, 404) : json(snapshot);
    if (target.hostname === 'ref123.supabase.co') return json([]);
    if (target.hostname === 'api.vercel.com') {
      assert.equal(init.headers.Authorization, 'Bearer vercel-token-0123456789');
      if (target.pathname === '/v6/deployments') return json({ deployments: [{ state: overrides.deployState || 'READY', created: NOW - 60_000, meta: { githubCommitSha: 'abcdef1234' } }] });
      if (target.pathname.endsWith('/config')) return json(overrides.domainConfig || { misconfigured: false, recommendedIPv4: [{ rank: 1, value: ['216.198.79.1', '64.29.17.1'] }], recommendedCNAME: [{ rank: 1, value: '6dbbb6e9e0c47844.vercel-dns-017.com.' }] });
      // Without overrides the token behaves like a project-scoped one: no team billing.
      if (target.pathname === '/v1/invoices/pre-commitment-usage') return overrides.ledger ? json(overrides.ledger) : json({ error: { code: 'forbidden' } }, 403);
      if (target.pathname === '/v1/billing/charges') return overrides.charges ? new Response(overrides.charges, { status: 200, headers: { 'content-type': 'application/jsonl' } }) : json({ error: { code: 'not_found', message: 'Plan not found.' } }, 404);
      return new Response('forbidden', { status: 403 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const dns = {
    resolve4: async () => overrides.aRecords || ['64.29.17.1', '216.198.79.1'],
    resolveCname: async () => ['6dbbb6e9e0c47844.vercel-dns-017.com.'],
    resolveNs: async () => ['ns.gabia.co.kr'],
  };
  const tlsInfo = async () => ({ validTo: overrides.certExpiry || '2027-01-29T14:20:00Z', issuer: "Let's Encrypt" });
  let lists = 0;
  const s3 = async () => ({
    listObjects: async prefix => { lists++; assert.equal(prefix, 'submissions/'); return { objects: overrides.objects || [
      { key: 'submissions/u/s/0b0e9f2a-1111-4222-8333-444455556666-video.mp4', size: 6e9, lastModified: '2026-01-01T00:00:00Z' },
      { key: 'submissions/u/s/a.wav', size: 1e9, lastModified: '2026-10-30T00:00:00Z' },
      { key: 'submissions/u/s/form.hwp', size: 1e5, lastModified: '2026-10-30T00:00:00Z' },
    ], truncated: false }; },
    listUnfinished: async () => overrides.unfinished || [],
    ...(overrides.hidden ? { listHidden: async prefix => { assert.equal(prefix, 'submissions/'); return overrides.hidden; } } : {}),
  });
  return { calls, fetch, dns, tlsInfo, s3, lists: () => lists };
}

const monitorWith = (f, settings = {}, backupStatusFile = '/nonexistent/onside-backup/last-status.json') => createSiteMonitor({ env, fetch: f.fetch, dns: f.dns, tlsInfo: f.tlsInfo, s3: f.s3, now: () => NOW, settings: () => settings, backupStatusFile });
const sectionOf = (snapshot, id) => snapshot.sections.find(item => item.id === id);
const item = (section, label) => section.items.find(entry => entry.label === label);

test('a healthy site reports every service and free-plan usage', async () => {
  const f = fakes();
  const snapshot = await monitorWith(f).snapshot(true);
  assert.equal(sectionOf(snapshot, 'site').status, 'ok', 'the accepted Kakao warning is informational');
  assert.equal(sectionOf(snapshot, 'domain').status, 'ok');
  assert.equal(sectionOf(snapshot, 'vercel').status, 'unknown', 'without a token Vercel is not checked');
  const b2 = sectionOf(snapshot, 'b2');
  assert.equal(b2.usage[0].percent, 70);
  assert.equal(b2.status, 'warning', '7GB of the free 10GB needs attention');
  assert.equal(b2.details.largest[0].name, 'video.mp4', 'upload UUID prefixes are hidden');
  assert.deepEqual(b2.details.categories.map(c => c.name), ['영상', '음원', '문서']);
  assert.equal(b2.details.aged.videoBytes, 6e9);
  const supabase = sectionOf(snapshot, 'supabase');
  assert.equal(supabase.usage.find(u => u.label.startsWith('Storage')).status, 'warning', '900MB of 1GB storage');
  assert.equal(snapshot.overall, 'warning');
  assert.ok(snapshot.issues.some(issue => issue.label.startsWith('저장 용량')));
  assert.ok(!JSON.stringify(snapshot).includes('service-role-key-value'));
});

test('the daily backup status is shown and goes stale after 26 hours', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-backup-status-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'last-status.json');
  const backupItem = async () => item(sectionOf(await monitorWith(fakes(), {}, file).snapshot(true), 'supabase'), 'DB 자동 백업');
  assert.equal((await backupItem()).status, 'warning', 'missing setup is flagged');
  await fs.writeFile(file, JSON.stringify({ ok: true, finishedAt: new Date(NOW - 3_600_000).toISOString(), database: { bytes: 5_000_000 } }));
  assert.equal((await backupItem()).status, 'ok');
  await fs.writeFile(file, JSON.stringify({ ok: true, finishedAt: new Date(NOW - 30 * 3_600_000).toISOString(), database: { bytes: 5_000_000 } }));
  assert.equal((await backupItem()).status, 'warning');
  await fs.writeFile(file, JSON.stringify({ ok: false, finishedAt: new Date(NOW).toISOString(), error: 'DATABASE_UNREACHABLE' }));
  assert.match((await backupItem()).value, /실패 · DATABASE_UNREACHABLE/);
});

test('outages, DNS drift and expiring certificates or domains are errors', async () => {
  const f = fakes({ siteDown: true, aRecords: ['216.24.57.1'], certExpiry: '2026-11-05T00:00:00Z', domainExpiry: '2026-11-20T00:00:00Z', noRpc: true });
  const snapshot = await monitorWith(f).snapshot(true);
  assert.equal(item(sectionOf(snapshot, 'site'), '사이트 응답').status, 'error');
  const domain = sectionOf(snapshot, 'domain');
  assert.equal(item(domain, '대표 주소(A)').status, 'error');
  assert.equal(item(domain, 'SSL 대표').status, 'error');
  assert.equal(item(domain, '도메인 만료').status, 'error');
  assert.match(item(sectionOf(snapshot, 'supabase'), '데이터베이스').value, /20261101120000/);
  assert.equal(snapshot.overall, 'error');
  assert.match(notificationText(snapshot), /외 \d+건$/);
});

test('a Vercel token adds deployment and domain checks; a failed deploy is a warning', async () => {
  const f = fakes({ deployState: 'ERROR' });
  const snapshot = await monitorWith(f, { vercelToken: 'vercel-token-0123456789' }).snapshot(true);
  const vercel = sectionOf(snapshot, 'vercel');
  assert.equal(item(vercel, '최근 배포').status, 'warning');
  assert.equal(item(vercel, '도메인 연결').value, '정상');
  const usageItem = item(vercel, '이번 달 사용량');
  assert.equal(usageItem.status, 'unknown', 'a project-scoped token cannot read team billing');
  assert.match(usageItem.hint, /All Projects/);
  assert.ok(!JSON.stringify(snapshot).includes('vercel-token-0123456789'));
});

const charge = (service, quantity, unit, cost, project, extra = {}) => JSON.stringify({ ChargePeriodStart: '2026-10-31T07:00:00.000Z', ChargePeriodEnd: '2026-11-01T07:00:00.000Z', ChargeCategory: 'Usage', BilledCost: 0, EffectiveCost: cost, ServiceName: service,
  ServiceCategory: unit === null ? 'Subscription Licenses' : 'Compute', ConsumedQuantity: quantity, ConsumedUnit: unit, Tags: project ? { ProjectId: project, ProjectName: project === 'prj_2BagpJ3xO4SYqS0taoYSdg2RlPRl' ? 'glit' : 'other' } : {}, ...extra });
const GLIT = 'prj_2BagpJ3xO4SYqS0taoYSdg2RlPRl', OTHER = 'prj_other';
const CHARGES = [
  charge('Pro', 1, null, 0.67), charge('Flat Rate CDN 1M', 1, null, 0),
  charge('CDN Requests', 600_000, 'Requests', 0.5, GLIT), charge('CDN Requests', 200_000, 'Requests', 0.2, OTHER),
  charge('Fluid Active CPU', 0.5, 'hour', 0.06, GLIT), charge('Fluid Active CPU', 1.5, 'hour', 0.2, OTHER),
  charge('Function Invocations', 3000, 'Invocations', 0.01, GLIT, { BilledCost: 4e-11 }), charge('Fast Data Transfer', 2, 'gigabyte', 0.6, GLIT),
  'not json', '',
].join('\n');

test('a team token shows the Pro credit, Flat Rate CDN headroom and Onside\'s share', async () => {
  const ledger = { creditLedgers: [{ currency: 'USD', total: 20, remaining: 4, periodStart: '2026-10-31T07:00:00.000Z', periodEnd: '2026-11-30T08:00:00.000Z' }] };
  const f = fakes({ ledger, charges: CHARGES });
  const monitor = monitorWith(f, { vercelToken: 'vercel-token-0123456789' });
  const vercel = sectionOf(await monitor.snapshot(true), 'vercel');
  const credit = vercel.usage.find(row => row.label.startsWith('Pro 월 크레딧'));
  assert.equal(credit.label, 'Pro 월 크레딧 ($20)');
  assert.deepEqual([credit.usedLabel, credit.limitLabel, credit.percent, credit.status], ['$16.00', '$20.00', 80, 'warning']);
  const cdn = vercel.usage.find(row => row.label.startsWith('CDN 요청'));
  assert.deepEqual([cdn.usedLabel, cdn.percent, cdn.status], ['800,000건', 80, 'warning']);
  assert.equal(vercel.usage.find(row => row.label.startsWith('데이터 전송')).usedLabel, '2.0 GB');
  assert.equal(item(vercel, '결제 주기').value, '10월 31일 ~ 11월 30일');
  assert.equal(item(vercel, '크레딧 초과 사용').status, 'ok');
  assert.equal(item(vercel, '온사이드 사용액').value, '$1.17 · 팀 전체 $1.57', 'licence rows are not usage');
  assert.equal(item(vercel, '이번 달 · 함수 CPU').value, '온사이드 30분 · 팀 2시간');
  assert.deepEqual(vercel.items.filter(entry => entry.label.startsWith('이번 달 ·')).map(entry => entry.label), ['이번 달 · 함수 CPU', '이번 달 · 함수 실행', '이번 달 · CDN 요청', '이번 달 · 데이터 전송']);
  assert.equal(vercel.status, 'warning');
  const chargeUrl = new URL(f.calls.find(url => url.includes('/v1/billing/charges')));
  assert.equal(chargeUrl.searchParams.get('from'), '2026-10-31T07:00:00.000Z');
  assert.equal(chargeUrl.searchParams.get('to'), '2026-11-03T00:00:00.000Z', 'through tomorrow, not the whole period');
  await monitor.snapshot(true);
  assert.equal(f.calls.filter(url => url.includes('/v1/billing/charges')).length, 1, 'forced refreshes reuse recent billing data');
});

test('usage past the credit is billed and flagged; without the ledger the $20 credit is assumed', async () => {
  const over = [charge('Fluid Active CPU', 300, 'hour', 23, GLIT, { BilledCost: 3 }), charge('Flat Rate CDN 1M', 1, null, 0)].join('\n');
  const billed = sectionOf(await monitorWith(fakes({ ledger: { creditLedgers: [{ currency: 'USD', total: 20, remaining: 0, periodStart: '2026-10-31T07:00:00.000Z', periodEnd: '2026-11-30T08:00:00.000Z' }] }, charges: over }), { vercelToken: 'vercel-token-0123456789' }).snapshot(true), 'vercel');
  assert.equal(billed.usage[0].status, 'error');
  assert.equal(item(billed, '크레딧 초과 사용').value, '$3.00 · Pro 요금 외 추가 청구 예정');
  const fallback = sectionOf(await monitorWith(fakes({ charges: CHARGES }), { vercelToken: 'vercel-token-0123456789' }).snapshot(true), 'vercel');
  assert.deepEqual([fallback.usage[0].usedLabel, fallback.usage[0].limitLabel], ['$1.57', '$20.00']);
  assert.match(item(fallback, '결제 주기').value, /^11월 1일부터/, 'calendar month when the ledger is unavailable');
});

test('a slow Vercel billing export keeps the last usage on screen and never flags the hosting', async () => {
  const ledger = { creditLedgers: [{ currency: 'USD', total: 20, remaining: 19.5, periodStart: '2026-10-31T07:00:00.000Z', periodEnd: '2026-11-30T08:00:00.000Z' }] };
  const overrides = { ledger, charges: CHARGES };
  const f = fakes(overrides);
  const slowFetch = async (url, init) => {
    if (overrides.slow && String(url).includes('/v1/billing/charges')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return f.fetch(url, init);
  };
  let clock = NOW;
  const monitor = createSiteMonitor({ env, fetch: slowFetch, dns: f.dns, tlsInfo: f.tlsInfo, s3: f.s3, now: () => clock, settings: () => ({ vercelToken: 'vercel-token-0123456789' }), backupStatusFile: '/nonexistent/last-status.json' });
  const fresh = sectionOf(await monitor.snapshot(true), 'vercel');
  assert.equal(fresh.usage[0].usedLabel, '$0.50');
  overrides.slow = true; clock += 31 * 60_000;
  const stale = sectionOf(await monitor.snapshot(true), 'vercel');
  assert.equal(stale.usage[0].usedLabel, '$0.50', 'the last successful usage stays');
  assert.match(item(stale, '사용량 기준 시각').value, /다음 확인 때 갱신/);
  assert.equal(stale.status, fresh.status, 'only the usage meters themselves decide the status');
  clock += 7 * 60 * 60_000;
  const expired = sectionOf(await monitor.snapshot(true), 'vercel');
  assert.deepEqual([item(expired, '이번 달 사용량').status, item(expired, '이번 달 사용량').value], ['unknown', 'Vercel 요금 정보 응답이 늦습니다. 다음 확인 때 다시 불러옵니다.']);
  assert.equal(expired.status, 'ok', 'a usage read failure is not a hosting problem');
});

test('DNS on an older Vercel IP pool is fine while Vercel accepts it; a flagged domain is an error', async () => {
  const domainConfig = { misconfigured: false, ipStatus: 'optional-change', recommendedIPv4: [{ rank: 1, value: ['216.150.1.1', '216.150.16.1'] }, { rank: 2, value: ['76.76.21.21'] }], recommendedCNAME: [{ rank: 1, value: '6dbbb6e9e0c47844.vercel-dns-017.com.' }] };
  const accepted = item(sectionOf(await monitorWith(fakes({ domainConfig }), { vercelToken: 'vercel-token-0123456789' }).snapshot(true), 'domain'), '대표 주소(A)');
  assert.equal(accepted.status, 'ok');
  assert.match(accepted.hint, /216\.150\.1\.1, 216\.150\.16\.1.*선택/);
  const moved = item(sectionOf(await monitorWith(fakes({ domainConfig, aRecords: ['216.150.16.1', '216.150.1.1'] }), { vercelToken: 'vercel-token-0123456789' }).snapshot(true), 'domain'), '대표 주소(A)');
  assert.deepEqual([moved.status, moved.hint], ['ok', undefined]);
  const flagged = sectionOf(await monitorWith(fakes({ domainConfig: { ...domainConfig, misconfigured: true } }), { vercelToken: 'vercel-token-0123456789' }).snapshot(true), 'domain');
  assert.equal(item(flagged, '대표 주소(A)').status, 'error');
});

test('B2 listing is cached and forced refreshes are rate-limited; stale multipart uploads warn', async () => {
  const f = fakes({ objects: [{ key: 'submissions/a.wav', size: 1e6, lastModified: '2026-10-30T00:00:00Z' }], unfinished: [{ key: 'submissions/b.mp4', initiated: '2026-10-29T00:00:00Z' }] });
  const monitor = monitorWith(f);
  const first = await monitor.snapshot(true);
  await monitor.snapshot(false); await monitor.snapshot(true);
  assert.equal(f.lists(), 1);
  assert.equal(item(sectionOf(first, 'b2'), '미완료 업로드').status, 'warning');
  assert.equal(fileCategory('x/clip.MOV'), '영상');
  assert.equal(worst(['ok', 'unknown', 'warning']), 'warning');
});

test('hidden and previous B2 versions count toward the billed total and point to the cleanup page', async () => {
  const objects = [{ key: 'submissions/guest/t/s/mv.mov', size: 2.2e9, lastModified: '2026-11-09T00:00:00Z' }];
  const b2 = sectionOf(await monitorWith(fakes({ objects, hidden: { count: 1, bytes: 539e6, markers: 2, truncated: false } })).snapshot(true), 'b2');
  assert.equal(b2.usage[0].used, 2.2e9 + 539e6, 'the usage bar matches the Backblaze console, not just current files');
  const row = item(b2, '이전 버전·숨은 사본');
  assert.equal(row.status, 'warning'); assert.match(row.value, /1개 · .*숨김 표시 2개/); assert.match(row.hint, /저장공간 정리 › 남은 파일/);
  const small = sectionOf(await monitorWith(fakes({ objects, hidden: { count: 2, bytes: 3e5, markers: 0, truncated: false } })).snapshot(true), 'b2');
  assert.equal(item(small, '이전 버전·숨은 사본').status, 'ok');
});

test('desk routes keep the Vercel token server-side, open only known links and notify once per problem', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-monitor-test-'));
  const opened = [], notes = [];
  let overall = 'error';
  const monitor = {
    snapshot: async () => ({ checkedAt: new Date(NOW).toISOString(), overall, issues: overall === 'ok' ? [] : [{ section: 'Supabase', label: 'DB', status: 'error' }], sections: [] }),
    links: () => ({ 'vercel-usage': 'https://vercel.com/team/~/usage' }),
  };
  const source = { sourceStatus: () => ({ configured: false }), fetchSubmissions: async () => [], fetchSubmission: async () => ({}) };
  const desk = await createDesk({ dataRoot, port: 0, source, monitor, openFolder: () => {}, openUrl: url => opened.push(url), notify: text => notes.push(text), timers: false });
  t.after(async () => { await desk.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${desk.server.address().port}`;
  const api = (route, init = {}) => fetch(url + route, { ...init, headers: { 'X-Desk-Token': desk.token, 'Content-Type': 'application/json', ...init.headers } });
  assert.equal((await fetch(url + '/api/monitor')).status, 403);
  const first = await (await api('/api/monitor')).json();
  assert.equal(first.snapshot.overall, 'error');
  await api('/api/monitor?refresh=1');
  assert.deepEqual(notes, ['Supabase: DB'], 'the same problem notifies once');
  assert.equal((await api('/api/monitor/settings', { method: 'POST', body: JSON.stringify({ vercelToken: 'bad token!' }) })).status, 400);
  const saved = await (await api('/api/monitor/settings', { method: 'POST', body: JSON.stringify({ vercelToken: 'vercel-token-0123456789', notify: false }) })).json();
  assert.deepEqual(saved.settings, { vercelConfigured: true, notify: false });
  assert.ok(!JSON.stringify(saved).includes('vercel-token-0123456789'));
  const stored = await fs.stat(path.join(dataRoot, 'monitor.json'));
  assert.equal(stored.mode & 0o777, 0o600);
  const state = await (await api('/api/state')).json();
  assert.equal(state.monitor.issues, 1);
  assert.ok(!JSON.stringify(state).includes('vercel-token-0123456789'));
  assert.equal((await api('/api/monitor/open', { method: 'POST', body: JSON.stringify({ target: 'https://evil.example' }) })).status, 400);
  assert.equal((await api('/api/monitor/open', { method: 'POST', body: JSON.stringify({ target: 'vercel-usage' }) })).status, 200);
  assert.deepEqual(opened, ['https://vercel.com/team/~/usage']);
  overall = 'ok'; await api('/api/monitor?refresh=1');
  assert.equal(notes.length, 1, 'recovery does not notify and notifications were turned off');
});

test('an open app window keeps working after the desk service restarts', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-session-test-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const source = { sourceStatus: () => ({ configured: false }), fetchSubmissions: async () => [], fetchSubmission: async () => ({}) };
  const monitor = { snapshot: async () => ({ checkedAt: new Date(NOW).toISOString(), overall: 'ok', issues: [], sections: [] }), links: () => ({}) };
  const start = () => createDesk({ dataRoot, port: 0, source, monitor, openFolder: () => {}, openUrl: () => {}, notify: () => {}, timers: false });
  const first = await start();
  const pageToken = first.token;
  await first.close();
  const second = await start();
  t.after(() => second.close());
  assert.equal(second.token, pageToken, 'the token survives an update or restart');
  assert.equal((await fs.stat(path.join(dataRoot, 'session.key'))).mode & 0o777, 0o600);
  const response = await fetch(`http://127.0.0.1:${second.server.address().port}/api/monitor`, { headers: { 'X-Desk-Token': pageToken } });
  assert.equal(response.status, 200);
});
