import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceBundle = process.argv[2] || '/private/tmp/onside-desk-build/온사이드 심의 데스크.app';
const target = path.join(os.homedir(), 'Applications', '온사이드 심의 데스크.app');
const dataRoot = path.join(os.homedir(), 'Library', 'Application Support', 'Onside Review Desk');
const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plist = path.join(agents, 'kr.onside.review-desk.plist');
const identity = `gui/${process.getuid()}/kr.onside.review-desk`;
process.umask(0o077);
// Validate the complete bundle before stopping a working installation.
for (const file of ['Contents/MacOS/OnsideDesk', 'Contents/Resources/app/remote.mjs', 'Contents/Resources/app/monitor.mjs', 'Contents/Resources/app/manual-upgrade.mjs', 'Contents/Resources/app/manual-import.mjs', 'Contents/Resources/app/manual-ole.mjs', 'Contents/Resources/app/manual-document-parser.mjs', 'Contents/Resources/app/screening.mjs', 'Contents/Resources/app/screening-engine.mjs', 'Contents/Resources/app/manual-translation.mjs', 'Contents/Resources/runtime/bin/node']) await fs.access(path.join(sourceBundle, file));
for (const dir of [path.dirname(target), dataRoot, agents]) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const connection = path.join(dataRoot, 'connection.env');
if (!await fs.stat(connection).catch(() => null)) {
  const env = parseEnv(await fs.readFile(path.resolve(here, '../../.env.local'), 'utf8'));
  const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'B2_S3_ENDPOINT', 'B2_REGION', 'B2_BUCKET', 'B2_PREFIX', 'B2_KEY_ID', 'B2_APPLICATION_KEY'];
  if (keys.filter(k => k !== 'B2_PREFIX').some(k => !env[k])) throw new Error('서비스 연결 환경설정이 불완전합니다.');
  await fs.writeFile(connection, keys.filter(k => env[k]).map(k => `${k}=${JSON.stringify(env[k])}`).join('\n') + '\n', { mode: 0o600 });
}
const savedEnv = parseEnv(await fs.readFile(connection, 'utf8'));
const additions = {};
if (!savedEnv.ONSIDE_DESK_SERVICE_URL) {
  const repoEnv = parseEnv(await fs.readFile(path.resolve(here, '../../.env.local'), 'utf8'));
  const serviceUrl = process.env.ONSIDE_DESK_SERVICE_URL || repoEnv.NEXT_PUBLIC_APP_URL;
  if (!serviceUrl || new URL(serviceUrl).protocol !== 'https:') throw new Error('온사이드 HTTPS 서비스 주소를 설정하세요.');
  additions.ONSIDE_DESK_SERVICE_URL = new URL(serviceUrl).origin;
}
if (!savedEnv.ONSIDE_DESK_ADMIN_USER_ID) {
  const selected = process.env.ONSIDE_DESK_ADMIN_USER_ID;
  const db = createClient(savedEnv.NEXT_PUBLIC_SUPABASE_URL, savedEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('profiles').select('user_id').eq('role', 'admin').limit(20);
  if (error) throw new Error('관리자 계정을 확인하지 못했습니다.');
  const actor = selected ? data?.find(row => row.user_id === selected) : data?.length === 1 ? data[0] : null;
  if (!actor) throw new Error('이 맥에서 사용할 관리자 ID를 ONSIDE_DESK_ADMIN_USER_ID로 지정하세요.');
  additions.ONSIDE_DESK_ADMIN_USER_ID = actor.user_id;
}
if (Object.keys(additions).length) await fs.appendFile(connection, '\n' + Object.entries(additions).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n');
await fs.chmod(connection, 0o600);
// Only an existing installation's own service is stopped.
try { execFileSync('/bin/launchctl', ['bootout', identity], { stdio: 'ignore' }); } catch {}
if (await fs.stat(target).catch(() => null)) {
  const previous = path.join(dataRoot, '이전 앱 버전');
  await fs.mkdir(previous, { recursive: true, mode: 0o700 });
  await fs.rename(target, path.join(previous, `온사이드 심의 데스크-${Date.now()}.app`));
}
await fs.cp(sourceBundle, target, { recursive: true });
const xml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const resources = path.join(target, 'Contents', 'Resources');
const values = [path.join(resources, 'runtime', 'bin', 'node'), path.join(resources, 'app', 'server.mjs')];
await fs.writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>kr.onside.review-desk</string><key>ProgramArguments</key><array>${values.map(v => `<string>${xml(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(path.join(resources, 'app'))}</string><key>EnvironmentVariables</key><dict><key>ONSIDE_DESK_DATA</key><string>${xml(dataRoot)}</string><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(path.join(dataRoot, 'app.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(dataRoot, 'error.log'))}</string></dict></plist>`, { mode: 0o600 });
execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'inherit' });
execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
execFileSync('/bin/launchctl', ['kickstart', identity]);
const shortcut = path.join(os.homedir(), 'Desktop', '온사이드 심의 데스크.app');
if (!await fs.lstat(shortcut).catch(() => null)) await fs.symlink(target, shortcut);
console.log(JSON.stringify({ installed: target, dataRoot, shortcut, service: identity }));
