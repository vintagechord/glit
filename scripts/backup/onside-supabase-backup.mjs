#!/usr/bin/env node
// Daily off-site backup of the Onside Supabase project (Free plan: no
// automatic backups). Runs from launchd (kr.onside.supabase-backup) on the
// operator's Mac; see scripts/backup/README.md.
//
//  - Database: one full `pg_dump --format=custom` (every schema: public, auth,
//    storage metadata, cron, …), verified with `pg_restore --list` and row
//    counts; 14 daily snapshots are kept.
//  - Supabase Storage (banners, magazine artwork): mirrored file by file into
//    a folder that never deletes local copies.
//  - Backblaze B2 (customer audio/video): a daily inventory (key, size, date,
//    ETag) only. The files are large and B2 keeps them; the inventory shows
//    what existed if something is removed.
//
// The database password is read from the login Keychain at run time
// (`onside-supabase-db`) and never touches disk or argv. Supabase/B2 API keys
// come from the review desk's production connection file (mode 600).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

const projectRef = 'rwysjsmxtpuqekeltwxi';
const region = 'ap-south-1';
const root = process.env.ONSIDE_BACKUP_DIR ?? join(homedir(), 'OnsideBackups');
const connectionFile = process.env.ONSIDE_BACKUP_CONNECTION ?? join(homedir(), 'Library', 'Application Support', 'Onside Review Desk', 'connection.env');
const keepDays = 14;
const bin = {
  pgDump: '/opt/homebrew/opt/libpq@17/bin/pg_dump',
  pgRestore: '/opt/homebrew/opt/libpq@17/bin/pg_restore',
  psql: '/opt/homebrew/opt/libpq@17/bin/psql',
};
// Direct connection first (IPv6); the session poolers cover IPv4-only networks.
const hosts = [
  { host: `db.${projectRef}.supabase.co`, user: 'postgres' },
  { host: `aws-1-${region}.pooler.supabase.com`, user: `postgres.${projectRef}` },
  { host: `aws-0-${region}.pooler.supabase.com`, user: `postgres.${projectRef}` },
];

// Dumps hold customer data: everything this script writes is owner-only.
process.umask(0o077);
const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', '_').replace(/:/g, '').slice(0, 15); // 2026-11-01_0440
const logDir = join(root, 'logs');
mkdirSync(logDir, { recursive: true, mode: 0o700 });
const log = message => appendFileSync(join(logDir, 'backup.log'), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });

function keychainPassword(service) {
  const result = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`KEYCHAIN_ITEM_MISSING ${service} (scripts/backup/README.md 참고)`);
  return result.stdout.trim();
}
function notify(title, message) {
  spawnSync('/usr/bin/osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function connection() {
  if (!existsSync(connectionFile)) throw new Error('CONNECTION_FILE_MISSING');
  const env = parseEnv(readFileSync(connectionFile, 'utf8'));
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!env[key]) throw new Error(`CONNECTION_VALUE_MISSING ${key}`);
  return env;
}

function connect(password) {
  for (const target of hosts) {
    const env = { ...process.env, PGPASSWORD: password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' };
    const probe = spawnSync(bin.psql, ['-h', target.host, '-p', '5432', '-U', target.user, '-d', 'postgres', '-At', '-c', 'select 1'], { env, encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === '1') return { ...target, env };
    log(`connect ${target.host}: ${(probe.stderr || '').trim().split('\n').pop()}`);
  }
  throw new Error('DATABASE_UNREACHABLE');
}
const query = (target, sql) => execFileSync(bin.psql, ['-h', target.host, '-p', '5432', '-U', target.user, '-d', 'postgres', '-At', '-F', '\t', '-c', sql], { env: target.env, encoding: 'utf8' }).trim();

async function backupDatabase(dir) {
  const target = connect(keychainPassword('onside-supabase-db'));
  const file = join(dir, 'onside-full.dump');
  execFileSync(bin.pgDump, ['-h', target.host, '-p', '5432', '-U', target.user, '-d', 'postgres', '--format=custom', '--compress=6', '--no-password', '-f', file], { env: target.env, stdio: ['ignore', 'ignore', 'pipe'] });
  const entries = execFileSync(bin.pgRestore, ['--list', file], { encoding: 'utf8' }).split('\n').filter(line => line && !line.startsWith(';')).length;
  if (entries < 100) throw new Error(`DUMP_TOO_SMALL ${entries}`);
  const counts = Object.fromEntries(query(target, `
    select 'auth.users', count(*) from auth.users
    union all select 'public.profiles', count(*) from public.profiles
    union all select 'public.submissions', count(*) from public.submissions
    union all select 'public.submission_files', count(*) from public.submission_files
    union all select 'public.submission_orders', count(*) from public.submission_orders
    union all select 'public.station_reviews', count(*) from public.station_reviews
    union all select 'public.submission_order_cash_receipts', count(*) from public.submission_order_cash_receipts
    union all select 'storage.objects', count(*) from storage.objects
    union all select 'migrations', count(*) from supabase_migrations.schema_migrations`)
    .split('\n').map(line => line.split('\t')).map(([name, value]) => [name, Number(value)]));
  return {
    host: target.host, serverVersion: query(target, 'show server_version'), file: 'onside-full.dump',
    bytes: statSync(file).size, sha256: await sha256(file), archiveEntries: entries, rowCounts: counts,
  };
}

async function backupSupabaseStorage(env) {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: buckets, error } = await db.storage.listBuckets();
  if (error) throw new Error(`STORAGE_LIST_FAILED ${error.message}`);
  const result = {};
  for (const bucket of buckets) {
    const dir = join(root, 'storage', bucket.name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let files = 0, bytes = 0, downloaded = 0;
    const walk = async prefix => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error: listError } = await db.storage.from(bucket.name).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (listError) throw new Error(`STORAGE_LIST_FAILED ${bucket.name}`);
        for (const item of data ?? []) {
          const path = prefix ? `${prefix}/${item.name}` : item.name;
          if (!item.id) { await walk(path); continue; } // folder
          const size = Number(item.metadata?.size ?? 0);
          const local = join(dir, path);
          files++; bytes += size;
          // No deletes, and unchanged files are not downloaded again.
          if (existsSync(local) && statSync(local).size === size) continue;
          const { data: blob, error: downloadError } = await db.storage.from(bucket.name).download(path);
          if (downloadError || !blob) throw new Error(`STORAGE_DOWNLOAD_FAILED ${bucket.name}`);
          mkdirSync(dirname(local), { recursive: true, mode: 0o700 });
          writeFileSync(local, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
          downloaded++;
        }
        if (!data || data.length < 1000) break;
      }
    };
    await walk('');
    result[bucket.name] = { files, bytes, downloaded };
  }
  return result;
}

async function inventoryB2(env, dir) {
  if (!env.B2_BUCKET || !env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_S3_ENDPOINT) return { skipped: 'B2 keys missing' };
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: env.B2_REGION, endpoint: env.B2_S3_ENDPOINT, credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY } });
  const objects = []; let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: env.B2_BUCKET, Prefix: env.B2_PREFIX || 'submissions/', ContinuationToken: token, MaxKeys: 1000 }));
    for (const item of page.Contents ?? []) objects.push({ key: item.Key, size: item.Size, lastModified: item.LastModified, etag: item.ETag });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  writeFileSync(join(dir, 'b2-inventory.json'), JSON.stringify({ bucket: env.B2_BUCKET, objects }, null, 1) + '\n', { mode: 0o600 });
  return { objects: objects.length, bytes: objects.reduce((sum, item) => sum + (item.size ?? 0), 0) };
}

function prune() {
  const dir = join(root, 'db');
  if (!existsSync(dir)) return [];
  const cutoff = Date.now() - keepDays * 86_400_000;
  const removed = [];
  for (const name of readdirSync(dir)) {
    // Only this script's own snapshot directories are ever removed.
    if (!/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(name)) continue;
    const path = join(dir, name);
    if (statSync(path).mtimeMs < cutoff) { rmSync(path, { recursive: true, force: true }); removed.push(name); }
  }
  return removed;
}

const lock = join(root, '.backup.lock');
if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 3 * 3_600_000) {
  log('skip: another backup is running');
  process.exit(0);
}
writeFileSync(lock, String(process.pid), { mode: 0o600 });
const status = { startedAt: new Date().toISOString(), ok: false };
try {
  const env = connection();
  const dir = join(root, 'db', stamp);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  status.database = await backupDatabase(dir);
  status.storage = await backupSupabaseStorage(env);
  status.b2Inventory = await inventoryB2(env, dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), projectRef, ...status.database, storage: status.storage, b2Inventory: status.b2Inventory, restore: 'see scripts/backup/README.md in the glit repository' }, null, 2) + '\n', { mode: 0o600 });
  status.pruned = prune();
  status.ok = true;
  log(`ok db=${status.database.bytes}B entries=${status.database.archiveEntries} users=${status.database.rowCounts['auth.users']} submissions=${status.database.rowCounts['public.submissions']} orders=${status.database.rowCounts['public.submission_orders']} storage=${JSON.stringify(status.storage)} b2=${JSON.stringify(status.b2Inventory)} pruned=${status.pruned.length}`);
} catch (error) {
  status.error = String(error?.message ?? error).split('\n')[0].slice(0, 300);
  log(`FAILED ${status.error}`);
  notify('온사이드 백업 실패', status.error);
  process.exitCode = 1;
} finally {
  status.finishedAt = new Date().toISOString();
  writeFileSync(join(root, 'last-status.json'), JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
  rmSync(lock, { force: true });
}
