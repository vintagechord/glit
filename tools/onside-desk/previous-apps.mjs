import fs from 'node:fs/promises';
import path from 'node:path';

// install-mac.mjs moves the running app here as "온사이드 심의 데스크-<Date.now()>.app".
const copyName = /^온사이드 심의 데스크-(\d+)\.app$/;

// Keeps the newest copies for rollback and deletes the rest; anything else in
// the folder is left alone. Returns the names it removed.
export async function prunePreviousApps(dir, keep = 2) {
  const names = await fs.readdir(dir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const copies = names
    .map(name => ({ name, stamp: copyName.exec(name.normalize('NFC'))?.[1] }))
    .filter(entry => entry.stamp)
    .sort((a, b) => Number(b.stamp) - Number(a.stamp));
  const removed = [];
  for (const { name } of copies.slice(keep)) {
    await fs.rm(path.join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
