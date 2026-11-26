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

// The audio check's Python worker is not imported by any module; the engine
// spawns it from <app>/audio-check/worker.py, so the folder must be copied too.
test('the audio check worker folder is copied into the Mac bundle and checked on install', async () => {
  const build = await fs.readFile(path.join(root, 'build-mac.mjs'), 'utf8');
  const install = await fs.readFile(path.join(root, 'install-mac.mjs'), 'utf8');
  const engine = await fs.readFile(path.join(root, 'audio-engine.mjs'), 'utf8');
  assert.match(engine, /path\.join\(APP_DIR, 'audio-check', 'worker\.py'\)/);
  assert.match(engine, /path\.join\(APP_DIR, 'audio-check', 'constraints\.txt'\)/);
  await fs.access(path.join(root, 'audio-check', 'worker.py'));
  await fs.access(path.join(root, 'audio-check', 'constraints.txt'));
  const copyList = build.match(/for \(const name of \[([^\]]*)\]\) await fs\.cp\(path\.join\(here, name\)/);
  assert.ok(copyList, 'build-mac.mjs copy list not found');
  assert.match(copyList[1], /'audio-check'/, 'audio-check/ is not copied by build-mac.mjs');
  assert.match(install, /'Contents\/Resources\/app\/audio-check\/worker\.py'/, 'audio-check/worker.py is not checked by install-mac.mjs');
  assert.match(install, /'Contents\/Resources\/app\/audio-check\/constraints\.txt'/, 'audio-check/constraints.txt is not checked by install-mac.mjs');
  // build-mac.mjs leaves out only caches and Python tests from the folder, so the constraints file ships.
  const filter = build.match(/filter: source => !(\/[^/]+\/)\.test\(path\.basename\(source\)\)/);
  assert.ok(filter, 'build-mac.mjs copy filter not found');
  const skipped = new RegExp(filter[1].slice(1, -1));
  assert.equal(skipped.test('constraints.txt'), false, 'build-mac.mjs filters out audio-check/constraints.txt');
  assert.equal(skipped.test('worker.py'), false);
  assert.equal(skipped.test('test_worker.py'), true);
});
