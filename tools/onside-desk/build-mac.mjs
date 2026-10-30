import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const output = process.argv[2] || '/private/tmp/onside-desk-build';
const bundle = path.join(output, '온사이드 심의 데스크.app');
const resources = path.join(bundle, 'Contents', 'Resources');
const payload = path.join(resources, 'app');
await fs.mkdir(payload, { recursive: true });
await fs.mkdir(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
for (const name of ['server.mjs', 'core.mjs', 'source.mjs', 'remote.mjs', 'documents.mjs', 'manual-upgrade.mjs', 'manual-import.mjs', 'manual-ole.mjs', 'manual-document-parser.mjs', 'screening.mjs', 'screening-engine.mjs', 'manual-translation.mjs', 'public', 'templates', 'README.md']) await fs.cp(path.join(here, name), path.join(payload, name), { recursive: true });
await fs.writeFile(path.join(payload, 'package.json'), JSON.stringify({ name: 'onside-review-desk', version: '2.3.3', private: true, type: 'module' }, null, 2));
const copied = new Set();
async function copyPackage(name, from) {
  const require = createRequire(path.join(from, 'package.json'));
  let base;
  try { base = path.dirname(require.resolve(`${name}/package.json`)); }
  catch {
    try { base = path.dirname(require.resolve(name)); }
    catch { return false; }
    while (base !== path.dirname(base)) {
      const meta = JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8').catch(() => '{}'));
      if (meta.name === name) break;
      base = path.dirname(base);
    }
  }
  if (copied.has(base)) return true;
  if (!base.startsWith(path.join(repo, 'node_modules') + path.sep)) throw new Error(`Dependency escaped repository: ${name}`);
  const manifest = JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8'));
  copied.add(base);
  await fs.cp(base, path.join(payload, path.relative(repo, base)), { recursive: true });
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    if (!await copyPackage(dependency, base)) throw new Error(`Missing dependency ${dependency}`);
  }
  for (const dependency of Object.keys(manifest.optionalDependencies || {})) await copyPackage(dependency, base);
  return true;
}
for (const name of ['@supabase/supabase-js', '@aws-sdk/client-s3', '@xmldom/xmldom', 'docxtemplater', 'pizzip', 'yazl']) if (!await copyPackage(name, repo)) throw new Error(`Missing ${name}`);
const runtimeArchive = process.env.ONSIDE_NODE_ARCHIVE || '/private/tmp/onside-node-runtime.tar.gz';
await fs.mkdir(path.join(resources, 'runtime'), { recursive: true });
execFileSync('/usr/bin/tar', ['-xzf', runtimeArchive, '--strip-components=1', '-C', path.join(resources, 'runtime'), 'node-v24.7.0-darwin-arm64/bin/node', 'node-v24.7.0-darwin-arm64/LICENSE']);
execFileSync('/usr/bin/xcrun', ['swiftc', path.join(here, 'mac', 'App.swift'), '-O', '-framework', 'AppKit', '-framework', 'WebKit', '-o', path.join(bundle, 'Contents', 'MacOS', 'OnsideDesk')], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(output, 'clang-cache'), SWIFT_MODULECACHE_PATH: path.join(output, 'swift-cache') } });
const retainedIcon = path.join(here, 'mac', 'AppIcon.icns');
if (await fs.stat(retainedIcon).catch(() => null)) {
  await fs.copyFile(retainedIcon, path.join(resources, 'AppIcon.icns'));
} else {
const iconTool = path.join(output, 'make-icon');
execFileSync('/usr/bin/xcrun', ['swiftc', path.join(here, 'mac', 'Icon.swift'), '-framework', 'AppKit', '-o', iconTool], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(output, 'clang-cache'), SWIFT_MODULECACHE_PATH: path.join(output, 'swift-cache') } });
execFileSync(iconTool, [path.join(output, 'AppIcon.iconset')]);
for (const name of await fs.readdir(path.join(output, 'AppIcon.iconset'))) {
  const match = name.match(/^icon_(\d+)x\d+(@2x)?\.png$/);
  if (match) { const size = String(Number(match[1]) * (match[2] ? 2 : 1)); execFileSync('/usr/bin/sips', ['-z', size, size, path.join(output, 'AppIcon.iconset', name)], { stdio: 'ignore' }); }
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', path.join(output, 'AppIcon.iconset'), '-o', path.join(resources, 'AppIcon.icns')]);
}
await fs.writeFile(path.join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OnsideDesk</string><key>CFBundleIdentifier</key><string>kr.onside.review-desk</string><key>CFBundleName</key><string>온사이드 심의 데스크</string><key>CFBundleDisplayName</key><string>온사이드 심의 데스크</string><key>CFBundleIconFile</key><string>AppIcon</string><key>CFBundleVersion</key><string>8</string><key>CFBundleShortVersionString</key><string>2.3.3</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/><key>LSMinimumSystemVersion</key><string>12.0</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
console.log(JSON.stringify({ bundle, dependencies: copied.size }));
