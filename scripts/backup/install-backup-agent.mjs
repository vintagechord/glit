#!/usr/bin/env node
// Installs the daily launchd agent for scripts/backup/onside-supabase-backup.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'kr.onside.supabase-backup';
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'onside-supabase-backup.mjs');
const root = join(homedir(), 'OnsideBackups');
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
const xml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// 04:40 KST: after the Artmelon backup (04:30), outside Watermelon's cron windows.
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>${xml(script)}</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>40</integer></dict>
<key>ProcessType</key><string>Background</string>
<key>LowPriorityIO</key><true/>
<key>StandardOutPath</key><string>${xml(join(root, 'logs', 'launchd.out.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(root, 'logs', 'launchd.err.log'))}</string>
</dict></plist>
`, { mode: 0o644 });
execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'inherit' });
const domain = `gui/${process.getuid()}`;
spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
execFileSync('/bin/launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
console.log(JSON.stringify({ installed: plist, schedule: '04:40 daily', backups: root }));
