#!/usr/bin/env node
// Installs the launchd agent for scripts/backup/onside-supabase-backup.mjs:
// started at login and at each time in schedule.mjs, it backs up once a day.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentPlist, START_TIMES } from './schedule.mjs';

const label = 'kr.onside.supabase-backup';
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'onside-supabase-backup.mjs');
const root = join(homedir(), 'OnsideBackups');
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
writeFileSync(plist, agentPlist({ label, script, root }), { mode: 0o644 });
execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'inherit' });
const domain = `gui/${process.getuid()}`;
spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
execFileSync('/bin/launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
console.log(JSON.stringify({ installed: plist, schedule: `once a day; starts at login and ${START_TIMES.map(({ hour, minute }) => `${String(hour).padStart(2, '0')}:${minute}`).join(', ')}`, backups: root }));
