import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prunePreviousApps } from '../previous-apps.mjs';

const appName = stamp => `온사이드 심의 데스크-${stamp}.app`;

async function folderWith(names) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-previous-apps-'));
  for (const name of names) {
    if (name.endsWith('.app')) {
      await fs.mkdir(path.join(dir, name, 'Contents'), { recursive: true });
      await fs.writeFile(path.join(dir, name, 'Contents', 'Info.plist'), 'plist');
    } else {
      await fs.writeFile(path.join(dir, name), 'other');
    }
  }
  return dir;
}

const listed = async dir => (await fs.readdir(dir)).map(name => name.normalize('NFC')).sort();

// Every desk install moves the running app here (146MB each) and nothing ever
// removed them: 14 copies had piled up by 2026-11-20.
test('keeps only the two newest previous desk apps by their install time', async () => {
  const dir = await folderWith([appName(1793615465472), appName(1795095682917), appName(1794284471357), appName(1794844666665)]);
  const removed = await prunePreviousApps(dir);
  assert.deepEqual(await listed(dir), [appName(1794844666665), appName(1795095682917)]);
  assert.deepEqual(removed.sort(), [appName(1793615465472), appName(1794284471357)]);
});

test('orders copies by the number in the name, not by text', async () => {
  const dir = await folderWith([appName(999), appName(1000), appName(20)]);
  await prunePreviousApps(dir);
  assert.deepEqual(await listed(dir), [appName(1000), appName(999)]);
});

test('matches names Finder stored in decomposed Korean', async () => {
  const dir = await folderWith([appName(1).normalize('NFD'), appName(2).normalize('NFD'), appName(3).normalize('NFD')]);
  await prunePreviousApps(dir);
  assert.deepEqual(await listed(dir), [appName(2), appName(3)]);
});

test('never touches anything that is not a previous desk app copy', async () => {
  const dir = await folderWith(['.DS_Store', '메모.txt', '온사이드 심의 데스크.app', '다른 앱-1.app', appName(1), appName(2), appName(3)]);
  await prunePreviousApps(dir);
  assert.deepEqual(await listed(dir), ['.DS_Store', '다른 앱-1.app', '메모.txt', appName(2), appName(3), '온사이드 심의 데스크.app'].sort());
});

test('removes nothing when two or fewer copies exist', async () => {
  const dir = await folderWith([appName(1), appName(2)]);
  assert.deepEqual(await prunePreviousApps(dir), []);
  assert.deepEqual(await listed(dir), [appName(1), appName(2)]);
});

test('a missing folder is not an error', async () => {
  const dir = path.join(os.tmpdir(), `onside-previous-apps-missing-${process.pid}-${Date.now()}`);
  assert.deepEqual(await prunePreviousApps(dir), []);
});

// Pruning runs only after the new app is installed and started, so a failed
// install still has its rollback copies.
test('install-mac.mjs prunes previous copies after the new app is started', async () => {
  const install = await fs.readFile(new URL('../install-mac.mjs', import.meta.url), 'utf8');
  assert.match(install, /import \{ prunePreviousApps \} from '\.\/previous-apps\.mjs';/);
  const kickstart = install.indexOf("execFileSync('/bin/launchctl', ['kickstart', identity]);");
  const prune = install.indexOf('prunePreviousApps(previous)');
  assert.ok(kickstart > 0 && prune > kickstart, 'prunePreviousApps(previous) must run after the kickstart');
});
