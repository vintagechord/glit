// When the daily backup is owed, and the launchd agent that asks.
//
// The agent used to start once, at 04:40. A Mac that is switched off at that
// minute gets no second chance from launchd (only a sleeping Mac does), so of
// the nine nights up to 2026-11-19 six went without a backup. The agent now
// also starts at login and three more times a day, and the script itself
// decides: it runs when no finished backup exists since the last 04:40.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KST = 9 * 3_600_000; // Korea has no daylight saving time.
const DAY = 86_400_000;
const minutes = (hour, minute) => hour * 60 + minute;

/** launchd start times (KST). The first one is the backup's own hour: after
 * the Artmelon backup (04:30) and, like the others, outside Watermelon's
 * measurement windows. */
export const START_TIMES = [{ hour: 4, minute: 40 }, { hour: 10, minute: 40 }, { hour: 16, minute: 40 }, { hour: 22, minute: 40 }];
/** Watermelon measures disk pressure at these times (KST); a start at login
 * that falls inside waits for the next start time. */
const QUIET_WINDOWS = [[minutes(12, 5), minutes(13, 40)], [minutes(18, 5), minutes(19, 40)]];

/** The most recent 04:40 KST: a backup finished at or after it covers today. */
export function dueSince(now = Date.now()) {
  const local = now + KST;
  const slot = Math.floor(local / DAY) * DAY + minutes(START_TIMES[0].hour, START_TIMES[0].minute) * 60_000;
  return (slot <= local ? slot : slot - DAY) - KST;
}

/** When the newest finished backup was made, or null. Only a finished backup
 * has a manifest; a failed or interrupted one leaves its folder without. */
export function latestSuccess(root) {
  const dir = join(root, 'db');
  if (!existsSync(dir)) return null;
  let latest = null;
  for (const name of readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(name)) continue;
    try {
      const made = Date.parse(JSON.parse(readFileSync(join(dir, name, 'manifest.json'), 'utf8')).createdAt);
      if (Number.isFinite(made) && (latest === null || made > latest)) latest = made;
    } catch { /* no manifest: that run did not finish */ }
  }
  return latest;
}

/** Whether a start by the agent should make a backup now. */
export function scheduledRunDecision(root, now = Date.now()) {
  const last = latestSuccess(root);
  if (last !== null && last >= dueSince(now)) return { run: false, reason: 'fresh' };
  const minuteOfDay = Math.floor(((now + KST) % DAY) / 60_000);
  if (QUIET_WINDOWS.some(([from, until]) => minuteOfDay >= from && minuteOfDay < until)) return { run: false, reason: 'quiet-window' };
  return { run: true, reason: 'due' };
}

const xml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The launchd agent: starts the script in scheduled mode at login and at
 * every start time. A start missed while asleep is made up on waking. */
export function agentPlist({ label = 'kr.onside.supabase-backup', script, root }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>${xml(script)}</string><string>--scheduled</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><array>
${START_TIMES.map(({ hour, minute }) => `<dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`).join('\n')}
</array>
<key>ProcessType</key><string>Background</string>
<key>LowPriorityIO</key><true/>
<key>StandardOutPath</key><string>${xml(join(root, 'logs', 'launchd.out.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(root, 'logs', 'launchd.err.log'))}</string>
</dict></plist>
`;
}
