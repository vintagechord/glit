import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The Mac app copies an explicit file list; a module the server imports but
// the bundle lacks stops the installed desk from starting at all.
test('every local module the desk server imports is copied into the Mac bundle and checked on install', async () => {
  const build = await fs.readFile(path.join(root, 'build-mac.mjs'), 'utf8');
  const install = await fs.readFile(path.join(root, 'install-mac.mjs'), 'utf8');
  const bundled = new Set([...build.matchAll(/'([\w-]+\.mjs)'/g)].map(match => match[1]));
  const seen = new Set(), pending = ['server.mjs'];
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const source = await fs.readFile(path.join(root, name), 'utf8');
    for (const match of source.matchAll(/(?:from|import\()\s*['"]\.\/([\w-]+\.mjs)['"]/g)) pending.push(match[1]);
  }
  for (const name of seen) {
    assert.ok(bundled.has(name), `${name} is imported but not copied by build-mac.mjs`);
    if (name !== 'server.mjs' && name !== 'core.mjs' && name !== 'source.mjs' && name !== 'documents.mjs' && name !== 'manual-translation.mjs') {
      assert.match(install, new RegExp(`Contents/Resources/app/${name.replace('.', '\\.')}`), `${name} is not checked by install-mac.mjs`);
    }
  }
});
