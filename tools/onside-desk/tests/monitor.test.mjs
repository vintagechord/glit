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
      if (target.pathname.endsWith('/config')) return json({ misconfigured: false, recommendedIPv4: [{ rank: 1, value: ['216.198.79.1', '64.29.17.1'] }], recommendedCNAME: [{ rank: 1, value: '6dbbb6e9e0c47844.vercel-dns-017.com.' }] });
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
  });
  return { calls, fetch, dns, tlsInfo, s3, lists: () => lists };
}

const monitorWith = (f, settings = {}) => createSiteMonitor({ env, fetch: f.fetch, dns: f.dns, tlsInfo: f.tlsInfo, s3: f.s3, now: () => NOW, settings: () => settings });
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
  assert.equal(item(vercel, '이번 달 사용량').status, 'unknown', 'Hobby usage is not available by API');
  assert.ok(!JSON.stringify(snapshot).includes('vercel-token-0123456789'));
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
