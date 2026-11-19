import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { agentPlist, dueSince, latestSuccess, scheduledRunDecision } from "../scripts/backup/schedule.mjs";

// The database has no other backup (Supabase Free plan). The agent ran only
// at 04:40, and a Mac that is switched off then gets no second chance: of the
// nine nights up to 2026-11-19 six were missed (11-12 to 11-14, 11-17 to
// 11-19) and nothing said so.

const kst = (text: string) => new Date(`${text}+09:00`).getTime();

function backups(stamps: Record<string, string | null>) {
  const root = mkdtempSync(join(tmpdir(), "onside-backup-"));
  for (const [stamp, createdAt] of Object.entries(stamps)) {
    mkdirSync(join(root, "db", stamp), { recursive: true });
    if (createdAt) writeFileSync(join(root, "db", stamp, "manifest.json"), JSON.stringify({ createdAt }));
  }
  return root;
}

test("a backup day starts at 04:40 KST", () => {
  assert.equal(dueSince(kst("2026-11-19T04:40:00")), kst("2026-11-19T04:40:00"));
  assert.equal(dueSince(kst("2026-11-19T23:59:00")), kst("2026-11-19T04:40:00"));
  assert.equal(dueSince(kst("2026-11-19T04:39:59")), kst("2026-11-18T04:40:00"));
  assert.equal(dueSince(kst("2026-11-19T00:10:00")), kst("2026-11-18T04:40:00"));
});

test("the newest finished backup counts; an unfinished folder does not", () => {
  const root = backups({
    "2026-11-16_0440": "2026-11-15T19:40:25.000Z",
    "2026-11-19_1844": "2026-11-19T09:44:47.000Z",
    "2026-11-19_2300": null, // interrupted: no manifest was written
    "notes": "2026-12-01T00:00:00.000Z", // not one of the script's folders
  });
  try {
    assert.equal(latestSuccess(root), Date.parse("2026-11-19T09:44:47.000Z"));
    assert.equal(latestSuccess(backups({})), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a Mac that was off at 04:40 backs up when it is next awake, once per day", () => {
  const root = backups({ "2026-11-16_0440": "2026-11-15T19:40:25.000Z" });
  try {
    // Switched on at 09:10 three days later: the night's backup is owed.
    assert.deepEqual(scheduledRunDecision(root, kst("2026-11-19T09:10:00")), { run: true, reason: "due" });
    // That backup covers the day: the 10:40, 16:40 and 22:40 starts do nothing.
    writeFileSync(join(root, "db", "2026-11-16_0440", "manifest.json"), JSON.stringify({ createdAt: new Date(kst("2026-11-19T09:11:00")).toISOString() }));
    for (const time of ["2026-11-19T10:40:00", "2026-11-19T16:40:00", "2026-11-19T22:40:00", "2026-11-20T04:39:00"]) {
      assert.deepEqual(scheduledRunDecision(root, kst(time)), { run: false, reason: "fresh" }, time);
    }
    // The next night's run is not put off by a late backup the day before.
    assert.deepEqual(scheduledRunDecision(root, kst("2026-11-20T04:40:00")), { run: true, reason: "due" });
  } finally { rmSync(root, { recursive: true, force: true }); }
  const empty = backups({});
  try { assert.deepEqual(scheduledRunDecision(empty, kst("2026-11-19T09:10:00")), { run: true, reason: "due" }); }
  finally { rmSync(empty, { recursive: true, force: true }); }
});

test("a catch-up never starts inside the other service's measurement windows", () => {
  const root = backups({});
  try {
    for (const time of ["2026-11-19T12:05:00", "2026-11-19T13:39:00", "2026-11-19T18:05:00", "2026-11-19T19:39:00"]) {
      assert.deepEqual(scheduledRunDecision(root, kst(time)), { run: false, reason: "quiet-window" }, time);
    }
    for (const time of ["2026-11-19T12:04:00", "2026-11-19T13:41:00", "2026-11-19T19:41:00"]) {
      assert.equal(scheduledRunDecision(root, kst(time)).run, true, time);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the agent starts at login and four times a day, in scheduled mode", () => {
  const plist = agentPlist({ script: "/repo/scripts/backup/onside-supabase-backup.mjs", root: "/Users/me/Onside & Backups" });
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  const starts = [...plist.matchAll(/<key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer>/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(starts, ["4:40", "10:40", "16:40", "22:40"]);
  assert.match(plist, /<string>\/repo\/scripts\/backup\/onside-supabase-backup\.mjs<\/string><string>--scheduled<\/string>/);
  assert.match(plist, /Onside &amp; Backups\/logs\/launchd\.err\.log/);
  // The installer and the script use these same definitions.
  assert.match(readFileSync("scripts/backup/install-backup-agent.mjs", "utf8"), /agentPlist\(/);
  assert.match(readFileSync("scripts/backup/onside-supabase-backup.mjs", "utf8"), /scheduledRunDecision\(/);
});
