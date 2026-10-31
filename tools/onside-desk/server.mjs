import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { createRemoteReviewClient } from './remote.mjs';
import { createSiteMonitor, notificationText, worst } from './monitor.mjs';
import { upgradeManualMvCases } from './manual-upgrade.mjs';
import { Store, now, safeName, childPath, atomicJSON, sha256, zipFiles, applyOverrides, caseWarnings, validateLocalPatch, validateSettings } from './core.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'Onside Review Desk');
export async function createDesk({ dataRoot = process.env.ONSIDE_DESK_DATA || DEFAULT_DATA, port = Number(process.env.ONSIDE_DESK_PORT || 43127), source, remote, generator, importer, reviewer, translator, openFolder, openUrl, monitor, notify, timers = true } = {}) {
  process.umask(0o077);
  if (!source) {
    const envFile = path.join(dataRoot, 'connection.env');
    try { process.loadEnvFile(envFile); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    source = await import('./source.mjs');
  }
  remote ||= createRemoteReviewClient(process.env);
  generator ||= (await import('./documents.mjs')).generateDocuments;
  importer ||= async input => (await import('./manual-import.mjs')).importReferenceDocument(input);
  reviewer ||= async input => (await import('./screening.mjs')).reviewLyrics(input);
  translator ||= async input => (await import('./manual-translation.mjs')).translateMissingLyrics(input);
  openFolder ||= target => { const child = spawn('/usr/bin/open', [target], { stdio: 'ignore' }); child.on('error', () => {}); };
  openUrl ||= openFolder;
  // Site monitoring settings live outside state.json so backups never copy the Vercel token.
  const monitorFile = path.join(dataRoot, 'monitor.json');
  let monitorSettings = { vercelToken: '', notify: true };
  try { monitorSettings = { ...monitorSettings, ...JSON.parse(await fs.readFile(monitorFile, 'utf8')) }; } catch { /* first run */ }
  monitor ||= createSiteMonitor({ env: process.env, settings: () => monitorSettings });
  notify ||= message => {
    const text = message.replace(/[\\"]/g, ' ').slice(0, 180);
    const child = spawn('/usr/bin/osascript', ['-e', `display notification "${text}" with title "온사이드 사이트 관리"`], { stdio: 'ignore' }); child.on('error', () => {});
  };
  const monitorState = { snapshot: null, running: null, notified: '' };
  async function runMonitor(force = false) {
    if (monitorState.running) return monitorState.running;
    monitorState.running = monitor.snapshot(force).then(snapshot => {
      // Notify once per new set of problems; recovery resets the memory.
      const signature = snapshot.issues.filter(issue => issue.status === 'error' || issue.status === 'warning').map(issue => `${issue.section}/${issue.label}/${issue.status}`).sort().join('|');
      if (signature && signature !== monitorState.notified && monitorSettings.notify !== false && worst([snapshot.overall]) !== 'ok') { try { notify(notificationText(snapshot)); } catch { /* notification is best effort */ } }
      monitorState.notified = signature;
      monitorState.snapshot = snapshot;
      return snapshot;
    }).finally(() => { monitorState.running = null; });
    return monitorState.running;
  }
  const monitorSettingsView = () => ({ vercelConfigured: Boolean(monitorSettings.vercelToken), notify: monitorSettings.notify !== false });
  const store = await new Store(dataRoot).init();
  const outputRoot = path.join(dataRoot, '신청별 자료');
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await upgradeManualMvCases({ store, outputRoot, importer });
  const token = randomBytes(32).toString('hex');
  let connected = false, syncPromise, queue = Promise.resolve(), closing = false;
  const shutdown = new AbortController();
  const caseDir = id => childPath(outputRoot, id);
  const activeOperations = new Map();
  let emptyingTrash = false;
  const getCase = (id, includeDeleted = false) => { const item = Object.hasOwn(store.data.cases, id) && store.data.cases[id]; if (!item) throw Object.assign(new Error('신청 내역을 찾을 수 없습니다. 먼저 동기화하세요.'), { status: 404 }); if (item.deletedAt && !includeDeleted) throw Object.assign(new Error('휴지통으로 이동한 신청입니다. 복원한 뒤 작업하세요.'), { status: 410, code: 'CASE_DELETED' }); return item; };
  const safeError = error => error?.message && !/(?:eyJ[A-Za-z0-9_-]{20}|https?:|secret|credential|Bearer)/i.test(error.message) ? error.message.slice(0, 500) : '작업에 실패했습니다. 연결 설정과 저장 공간을 확인한 뒤 다시 시도하세요.';
  function summary(item) {
    const s = item.source === 'manual' ? applyOverrides(item.detail, item.local).submission : item.submission;
    return { id: s.id, source: item.source || 'online', deletedAt: item.deletedAt || null, purgePending: !!item.purgeRequestedAt, type: s.type, title: s.title, artist_name: s.artist_name, applicant_name: s.applicant_name, created_at: s.created_at, updated_at: s.updated_at, release_date: s.release_date, status: s.status, payment_status: s.payment_status, files_submitted_by_email: s.files_submitted_by_email, local: item.local, warnings: item.detail ? caseWarnings({ ...item.detail, localAttachments: item.attachments || [] }, item.local) : [], latestGeneration: item.generations?.at(-1) || null, sourceChanged: !!item.sourceChanged };
  }
  function publicState() {
    const cases = Object.values(store.data.cases).map(summary).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { monitor: monitorState.snapshot ? { overall: monitorState.snapshot.overall, issues: monitorState.snapshot.issues.length, checkedAt: monitorState.snapshot.checkedAt } : null, connection: { ...source.sourceStatus(), connected, resultsConfigured: remote.configured(), message: connected ? remote.configured() ? '온사이드 관리자 연동' : '신청 조회 연결 · 결과 연동 설정 필요' : store.data.syncError || '연결 대기 중' }, settings: store.data.settings, lastSync: store.data.lastSync, syncError: store.data.syncError, syncing: !!syncPromise, cases: cases.filter(c => !c.deletedAt), trashCases: cases.filter(c => c.deletedAt), jobs: store.data.jobs.filter(j => !store.data.cases[j.caseId]?.deletedAt).slice(0, 60), outputRoot, version: '2.4.0' };
  }
  async function detail(id, refresh = false) {
    const item = getCase(id);
    let offlineWarning;
    if (item.source !== 'manual' && (refresh || !item.detail || item.detailStale)) {
      try {
        const latest = await source.fetchSubmission(id);
        if (item.detail && JSON.stringify(item.detail) !== JSON.stringify(latest)) item.sourceChanged = !!item.generations?.length;
        item.detail = latest; item.detailStale = false; item.submission = latest.submission; item.fetchedAt = now(); connected = true;
        await store.save();
      } catch (error) {
        connected = false;
        if (!item.detail) throw error;
        offlineWarning = '최신 정보를 불러오지 못해 마지막으로 저장한 신청 내역을 사용합니다.';
        if (refresh) throw new Error('최신 신청 내용을 확인하지 못했습니다. 인터넷 연결 후 다시 실행하세요. 저장된 자료는 계속 열람할 수 있습니다.');
      }
    }
    const base = { ...item.detail, source: item.source || 'online', localAttachments: item.attachments || [], warnings: [...new Set([...(item.detail.warnings || []), ...(item.source === 'manual' ? item.importInfo?.warnings || [] : [])])] };
    const effective = applyOverrides(base, item.local);
    const screening = item.source === 'manual' ? await reviewer(effective) : undefined;
    return { ...effective, sourceSubmission: item.detail.submission, local: item.local, generations: item.generations || [], localAttachments: item.attachments || [], downloads: item.downloads || [], history: item.history || [], fetchedAt: item.fetchedAt, warnings: [...caseWarnings(base, item.local), ...(offlineWarning ? [offlineWarning] : [])], sourceChanged: !!item.sourceChanged,
      ...(item.source === 'manual' ? { importInfo: item.importInfo, screening: { ...screening, acknowledged: !!screening?.sourceHash && item.local.reviewAcknowledgedRevision === screening.sourceHash } } : {}) };
  }
  async function importManual(body, filename, type) {
    if (!['ALBUM', 'MV_DISTRIBUTION', 'MV_BROADCAST'].includes(type)) throw Object.assign(new Error('음반 또는 뮤비 작업 유형을 선택하세요.'), { status: 400 });
    const imported = await importer({ body, filename, type });
    if (!imported || !Array.isArray(imported.tracks) || imported.tracks.length > 999 || typeof imported.extractedText !== 'string' || imported.extractedText.length > 1_000_000) throw new Error('기준파일의 내용을 처리하지 못했습니다. 텍스트와 트랙 구성을 확인하세요.');
    const id = `manual-${randomUUID()}`, timestamp = now();
    const submission = { ...(imported.submission || {}), id, type, status: 'RECEIVED', payment_status: null, created_at: timestamp, updated_at: timestamp, files_submitted_by_email: true };
    const tracks = imported.tracks.map((track, i) => ({ ...track, id: `local-${randomUUID()}`, track_no: Number.isInteger(track.track_no) && track.track_no > 0 ? track.track_no : i + 1 }));
    const originalName = safeName(filename, '기준파일');
    const dir = path.join(caseDir(id), '기준파일'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const originalPath = path.join(dir, originalName); await fs.writeFile(originalPath, body, { flag: 'wx', mode: 0o600 });
      const importInfo = { parserVersion: 4, filename: originalName, format: imported.format, warnings: imported.warnings || [], extractedText: imported.extractedText, importedAt: timestamp, bytes: body.length, sha256: await sha256(originalPath) };
      await fs.writeFile(path.join(dir, '추출 원문.txt'), imported.extractedText, { mode: 0o600 });
      const parsed = { source: 'manual', submission, tracks, stations: [], stationReviews: [], files: [], assets: [], warnings: [] };
      store.data.cases[id] = { source: 'manual', submission, detail: parsed, importInfo, local: { stage: 'CHECKING', notes: '', dueDate: '', checklist: {} }, generations: [], downloads: [], attachments: [], history: [], fetchedAt: timestamp };
      store.audit(id, 'manual_import', `기준파일에서 수동 작업을 만들었습니다: ${originalName}`);
      const importedDetail = await detail(id);
      await store.save();
      return { id, detail: importedDetail };
    } catch (error) {
      delete store.data.cases[id]; await fs.rm(caseDir(id), { recursive: true, force: true }).catch(() => {}); throw error;
    }
  }
  async function sync() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const previousSync = store.data.lastSync;
      try {
        const submissions = await source.fetchSubmissions();
        const toGenerate = [];
        for (const submission of submissions) {
          if (Object.hasOwn(store.data.purgedCases, submission.id)) continue;
          const old = store.data.cases[submission.id];
          if (!old) {
            store.data.cases[submission.id] = { submission, local: { stage: 'RECEIVED', notes: '', dueDate: '', checklist: {} }, generations: [], downloads: [], attachments: [], history: [] };
            store.audit(submission.id, 'sync', '온사이드 신청을 처음 가져왔습니다.');
            if (previousSync && store.data.settings.autoGenerate && submission.payment_status === 'PAID') toGenerate.push(submission.id);
          } else {
            if (old.source === 'manual' || old.deletedAt) continue;
            if (old.submission.updated_at !== submission.updated_at) { old.sourceChanged = !!old.generations?.length; old.detailStale = true; }
            if (previousSync && store.data.settings.autoGenerate && old.submission.payment_status !== 'PAID' && submission.payment_status === 'PAID' && !old.generations?.length) toGenerate.push(submission.id);
            old.submission = submission;
          }
        }
        store.data.lastSync = now(); store.data.syncError = null; connected = true;
        await store.save();
        const dailyBackup = path.join(dataRoot, '자동백업', `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}.json`);
        if (!await fs.stat(dailyBackup).catch(() => null)) await atomicJSON(dailyBackup, store.data);
        for (const id of toGenerate) if (store.data.cases[id] && !store.data.cases[id].deletedAt) enqueue(id, 'generate');
        return { count: submissions.length, lastSync: store.data.lastSync };
      } catch (error) {
        connected = false; store.data.syncError = safeError(error); await store.save(); throw error;
      } finally { syncPromise = null; }
    })();
    return syncPromise;
  }
  async function emptyTrash(input) {
    if (emptyingTrash) throw Object.assign(new Error('휴지통을 비우고 있습니다. 잠시 후 다시 확인하세요.'), { status: 409, code: 'TRASH_BUSY' });
    if (input?.confirmation !== 'EMPTY_TRASH' || !Array.isArray(input.cases) || !input.cases.length || input.cases.length > 10000 || new Set(input.cases.map(item => item?.id)).size !== input.cases.length) throw Object.assign(new Error('삭제할 휴지통 항목을 확인한 뒤 다시 시도하세요.'), { status: 400 });
    // Validate the entire confirmed snapshot before removing anything. Newly trashed
    // cases and cases restored while the confirmation was open are never swept up.
    const targets = input.cases.map(target => {
      const item = typeof target?.id === 'string' && Object.hasOwn(store.data.cases, target.id) && store.data.cases[target.id];
      if (!item?.deletedAt || item.deletedAt !== target.deletedAt) throw Object.assign(new Error('휴지통 목록이 변경되었습니다. 새로고침한 뒤 다시 확인하세요.'), { status: 409, code: 'TRASH_CHANGED' });
      if (activeOperations.get(target.id) || store.data.jobs.some(job => job.caseId === target.id && ['queued', 'running'].includes(job.status))) throw Object.assign(new Error('진행 중인 작업이 있습니다. 완료된 뒤 휴지통을 비우세요.'), { status: 409, code: 'CASE_BUSY' });
      return { id: target.id, item };
    });
    emptyingTrash = true;
    try {
      // Persist intent first. If disk removal is interrupted, restoration stays
      // disabled and the same confirmed operation can safely be retried.
      for (const { item } of targets) item.purgeRequestedAt ||= now();
      await store.save();
      let deletedCount = 0;
      const failedCases = [];
      for (const { id, item } of targets) {
        try {
          await fs.rm(caseDir(id), { recursive: true, force: true });
        } catch (error) {
          failedCases.push({ id, error: safeError(error) });
          continue;
        }
        if (item.source !== 'manual') store.data.purgedCases[id] = item.purgeRequestedAt;
        delete store.data.cases[id];
        store.data.jobs = store.data.jobs.filter(job => job.caseId !== id);
        await store.save();
        deletedCount++;
      }
      return { ok: failedCases.length === 0, deletedCount, failedCases };
    } finally { emptyingTrash = false; }
  }
  async function download(id, job) {
    const current = await detail(id, true);
    const item = getCase(id);
    if (item.source === 'manual') return { count: item.attachments?.length || 0, warnings: item.attachments?.length ? [] : ['별도로 받은 음원·영상 원본을 연결하세요.'], failed: 0 };
    const destination = path.join(caseDir(id), '원본 파일');
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    const assets = current.assets || [];
    const results = [], errors = [];
    for (const [index, asset] of assets.entries()) {
      job.message = `원본 파일 ${index + 1}/${assets.length} 다운로드 중`; await store.save();
      const identity = asset.objectKey || asset.file_path || asset.path || asset.id;
      const cached = (item.downloads || []).find(d => d.sourceKey === identity);
      if (cached) {
        const st = await fs.stat(path.join(destination, cached.name)).catch(() => null);
        if (st?.size === cached.bytes && (!asset.size || Number(asset.size) === st.size) && cached.sha256 === await sha256(path.join(destination, cached.name))) { results.push(cached); continue; }
      }
      let name = `${String(index + 1).padStart(2, '0')}_${safeName(asset.original_name || asset.originalName || asset.name || asset.filename || '원본')}`;
      if (await fs.stat(path.join(destination, name)).catch(() => null)) name = `${randomUUID().slice(0, 8)}_${name}`;
      try {
        const saved = await source.downloadAsset(asset, path.join(destination, name), { signal: shutdown.signal });
        results.push({ name, bytes: saved.bytes, sha256: saved.sha256, sourceKey: identity, createdAt: now() });
      } catch (error) { errors.push(`${name}: ${safeError(error)}`); }
    }
    item.downloads = results;
    const message = [current.submission.files_submitted_by_email ? '신청 시 이메일로 전달한 파일이 있습니다. 수신함에서 실제 파일을 확인하고 앱의 이메일 파일 추가 기능으로 보관하세요.' : '', !assets.length ? '서비스에서 다운로드할 업로드 파일을 찾지 못했습니다.' : '', ...errors].filter(Boolean).join('\n');
    await fs.writeFile(path.join(destination, '파일 수신 현황.txt'), `신청 ID: ${id}\n확인 일시: ${now()}\n\n${message}\n\n다운로드한 파일\n${results.map(r => `${r.name} (${r.bytes} bytes) SHA256 ${r.sha256}`).join('\n')}\n\n로컬 추가 파일\n${(item.attachments || []).map(a => a.name).join('\n')}`, { mode: 0o600 });
    store.audit(id, 'download', `${results.length}개 원본 파일 저장${errors.length ? `, ${errors.length}개 실패` : ''}`);
    await store.save();
    return { count: results.length, warnings: message ? message.split('\n') : [], failed: errors.length };
  }
  async function generate(id, job) {
    const current = await detail(id, true);
    const item = getCase(id);
    const generatedOverrides = JSON.stringify(item.local.overrides || {});
    const generationId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
    const dir = path.join(caseDir(id), '생성 이력', generationId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    job.message = '신청 내용과 가사로 문서를 생성하는 중'; await store.save();
    try {
      const result = await generator({ ...current, ...(item.source === 'manual' ? { files: current.localAttachments || [] } : {}), outputDir: dir, settings: store.data.settings });
      const warnings = [...new Set([...current.warnings, ...(result.warnings || [])])];
      if (!store.data.settings.managerName || !store.data.settings.managerPhone) warnings.push('앱 설정에서 심의 담당자 이름·연락처를 입력하고 다시 생성하세요.');
      const album = current.submission.type === 'ALBUM';
      const artifactList = (result.artifacts || []).map(a => ({ name: a.name, type: a.type, bytes: a.bytes }));
      if (album) {
      await atomicJSON(path.join(dir, '신청내용_생성시점.json'), { generatedAt: now(), submission: current.submission, tracks: current.tracks, stations: current.stations, stationReviews: current.stationReviews, local: current.local, warnings });
      await fs.writeFile(path.join(dir, '제출전_확인사항.txt'), `온사이드 심의 데스크\n신청 ID ${id}\n\n${warnings.length ? warnings.map(x => `□ ${x}`).join('\n') : '신청 내용 기준 자동 점검을 통과했습니다.'}\n\n□ 생성된 문서의 페이지·가사·크레딧을 최종 확인\n□ 이메일 전달 파일 실제 수신 여부 확인\n□ 기관별 제출 화면의 필수 항목 확인\n\n자동 점검은 기관의 접수·심의 승인을 의미하지 않습니다.\n`, { mode: 0o600 });
      for (const name of ['신청내용_생성시점.json', '제출전_확인사항.txt']) {
        const st = await fs.stat(path.join(dir, name));
        if (st.isFile()) artifactList.push({ name, type: path.extname(name).slice(1), bytes: st.size });
      }
      }
      const generation = { id: generationId, createdAt: now(), artifacts: artifactList, warnings, sourceUpdatedAt: current.submission.updated_at,
        ...(!album ? { snapshot: structuredClone({ submission: current.submission, local: current.local }), screening: result.screening || current.screening } : {}) };
      item.generations ||= []; item.generations.push(generation);
      item.sourceChanged = item.submission.updated_at !== current.submission.updated_at || JSON.stringify(item.local.overrides || {}) !== generatedOverrides;
      if (['RECEIVED', 'CHECKING', 'PREPARING'].includes(item.local.stage)) item.local.stage = warnings.length || item.sourceChanged ? 'CHECKING' : 'READY';
      store.audit(id, 'generate', `심의 문서 ${artifactList.length}개 저장, 확인 항목 ${warnings.length}개`);
      await store.save();
      job.message = item.source === 'manual' ? '수동 심의 자료 생성 완료' : '문서 생성 완료 · 원본 파일 다운로드 중'; await store.save();
      const downloaded = item.source === 'manual' ? { count: 0, warnings: [], failed: 0 } : await download(id, job);
      return { generationId, artifacts: artifactList.length, warnings: [...warnings, ...downloaded.warnings], downloaded: downloaded.count, failed: downloaded.failed };
    } catch (error) {
      await fs.writeFile(path.join(dir, '작업오류.txt'), safeError(error), { mode: 0o600 }).catch(() => {});
      throw error;
    }
  }
  function enqueue(id, kind) {
    getCase(id);
    const existing = store.data.jobs.find(j => j.caseId === id && j.kind === kind && ['queued', 'running'].includes(j.status));
    if (existing) return existing;
    const job = { id: randomUUID(), caseId: id, kind, status: 'queued', message: '대기 중', createdAt: now() };
    store.data.jobs.unshift(job); store.data.jobs = store.data.jobs.slice(0, 300); void store.save();
    queue = queue.catch(() => {}).then(async () => {
      if (closing) return;
      job.status = 'running'; job.startedAt = now(); await store.save();
      try {
        job.result = await (kind === 'generate' ? generate(id, job) : download(id, job));
        job.status = job.result.failed ? 'failed' : 'completed';
        job.message = job.result.failed ? `다운로드 ${job.result.failed}개 실패 · 다시 실행하면 이어받습니다.` : kind === 'generate' ? `자료 생성 완료 · 확인 항목 ${job.result.warnings.length}개` : `원본 ${job.result.count}개 저장 완료`;
      } catch (error) { job.status = 'failed'; job.message = safeError(error); store.audit(id, 'error', job.message); }
      job.finishedAt = now(); await store.save();
    });
    return job;
  }
  async function backup() {
    await store.save();
    const backupDir = path.join(dataRoot, '백업'); await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const stamp = now().replace(/[:.]/g, '-');
    const snapshotFile = path.join(backupDir, `.${stamp}.json`);
    await atomicJSON(snapshotFile, store.data);
    const entries = [{ name: 'state.json', path: snapshotFile }];
    async function walk(dir, relative = '') {
      for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        if (ent.isSymbolicLink()) continue;
        const rel = path.join(relative, ent.name);
        if (ent.isDirectory()) { if (['원본 파일', '이메일 파일'].includes(ent.name)) continue; await walk(path.join(dir, ent.name), rel); }
        else if (ent.isFile()) entries.push({ name: path.join('신청별 자료', rel), path: path.join(dir, ent.name) });
      }
    }
    await walk(outputRoot);
    const filename = `온사이드_관리백업_${stamp}.zip`;
    try { await zipFiles(path.join(backupDir, filename), entries); } finally { await fs.unlink(snapshotFile); }
    openFolder(backupDir);
    return { filename, path: path.join(backupDir, filename), message: '관리 내역과 생성 문서를 백업했습니다. 대용량 음원·영상 원본과 연결 키는 제외됩니다.' };
  }
  const sendJSON = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  async function readJSON(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 3 * 1024 * 1024) throw Object.assign(new Error('입력 데이터가 너무 큽니다.'), { status: 413 }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw Object.assign(new Error('JSON 입력 형식을 확인하세요.'), { status: 400 }); }
  }
  async function readCertificate(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) throw Object.assign(new Error('필증은 4MB까지 업로드할 수 있습니다.'), { status: 413 }); chunks.push(chunk); }
    if (!size) throw Object.assign(new Error('필증 파일을 선택하세요.'), { status: 400 });
    return Buffer.concat(chunks);
  }
  async function readReference(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 20 * 1024 * 1024) throw Object.assign(new Error('기준파일은 20MB까지 가져올 수 있습니다.'), { status: 413 }); chunks.push(chunk); }
    if (!size) throw Object.assign(new Error('기준파일을 선택하세요.'), { status: 400 });
    return Buffer.concat(chunks);
  }
  function requireOnlineCase(id) {
    const item = getCase(id);
    if (item.source === 'manual') throw Object.assign(new Error('관리자 수동 작업은 온라인 신청과 연동하지 않습니다.'), { status: 409, code: 'MANUAL_CASE_LOCAL_ONLY' });
    return item;
  }
  async function afterRemoteSave(id, result, label) {
    const item = getCase(id); item.detailStale = true;
    if (result.changed) store.audit(id, 'result', label);
    if (result.notification) store.audit(id, 'notification', `메일: 서버 접수 ${result.notification.deliveredCount || 0}, 대기 ${result.notification.queuedCount || 0}, 실패 ${result.notification.failedCount || 0}${result.notification.pendingAssets ? ' · 자료 준비 대기' : ''}`);
    // A successful remote save must stay successful even when the subsequent refresh is offline.
    await detail(id, true).catch(() => {});
    await store.save();
    return result;
  }
  function checkToken(req) {
    const cookie = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('desk-session='))?.slice(13);
    const supplied = req.headers['x-desk-token'] || (req.method === 'GET' ? cookie : '');
    return typeof supplied === 'string' && supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  }
  const server = http.createServer(async (req, res) => {
    let activeCaseId;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host;
      const localHost = `127.0.0.1:${server.address()?.port}`;
      if (host !== localHost && host !== `localhost:${server.address()?.port}`) return sendJSON(res, 403, { error: '로컬 앱 주소로 접속하세요.' });
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && ![`http://${localHost}`, `http://localhost:${server.address()?.port}`].includes(req.headers.origin))) return sendJSON(res, 403, { error: '다른 사이트의 요청은 허용하지 않습니다.' });
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/health' && req.method === 'GET') return sendJSON(res, 200, { app: 'onside-review-desk', version: '2.4.0' });
      if (!url.pathname.startsWith('/api/')) {
        const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
        const file = files[url.pathname];
        if (!file || req.method !== 'GET') return sendJSON(res, 404, { error: '페이지를 찾을 수 없습니다.' });
        let content = await fs.readFile(path.join(appDir, 'public', file), 'utf8');
        if (file === 'index.html') { content = content.replaceAll('__CSRF_TOKEN__', token); res.setHeader('Set-Cookie', `desk-session=${token}; HttpOnly; SameSite=Strict; Path=/`); }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
        return res.end(content);
      }
      if (!checkToken(req)) return sendJSON(res, 403, { error: '앱 화면을 새로고침한 후 다시 시도하세요.' });
      if (url.pathname === '/api/state' && req.method === 'GET') return sendJSON(res, 200, publicState());
      if (url.pathname === '/api/trash/empty' && req.method === 'POST') return sendJSON(res, 200, await emptyTrash(await readJSON(req)));
      if (url.pathname === '/api/manual/import' && req.method === 'POST') {
        const filename = url.searchParams.get('filename');
        if (!filename || filename.length > 500) return sendJSON(res, 400, { error: '기준파일 이름을 확인하세요.' });
        return sendJSON(res, 201, await importManual(await readReference(req), filename, url.searchParams.get('type') || 'ALBUM'));
      }
      if (url.pathname === '/api/connection' && req.method === 'GET') return sendJSON(res, 200, await remote.health());
      if (url.pathname === '/api/sync' && req.method === 'POST') return sendJSON(res, 200, await sync());
      if (url.pathname === '/api/settings' && req.method === 'POST') { store.data.settings = validateSettings(await readJSON(req), store.data.settings); await store.save(); return sendJSON(res, 200, { settings: store.data.settings }); }
      if (url.pathname === '/api/backup' && req.method === 'POST') return sendJSON(res, 200, await backup());
      if (url.pathname === '/api/open-output' && req.method === 'POST') { openFolder(outputRoot); return sendJSON(res, 200, { opened: true }); }
      if (url.pathname === '/api/monitor' && req.method === 'GET') return sendJSON(res, 200, { snapshot: await runMonitor(url.searchParams.get('refresh') === '1'), settings: monitorSettingsView() });
      if (url.pathname === '/api/monitor/settings' && req.method === 'POST') {
        const body = await readJSON(req);
        const next = { ...monitorSettings };
        if (body.vercelToken === null || body.vercelToken === '') next.vercelToken = '';
        else if (body.vercelToken !== undefined) {
          const value = String(body.vercelToken).trim();
          if (!/^[A-Za-z0-9_.-]{16,256}$/.test(value)) return sendJSON(res, 400, { error: 'Vercel 토큰 형식을 확인하세요.' });
          next.vercelToken = value;
        }
        if (body.notify !== undefined) next.notify = body.notify === true;
        monitorSettings = next; await atomicJSON(monitorFile, monitorSettings);
        return sendJSON(res, 200, { settings: monitorSettingsView(), snapshot: await runMonitor(true) });
      }
      if (url.pathname === '/api/monitor/open' && req.method === 'POST') {
        const target = String((await readJSON(req)).target || '');
        const link = Object.hasOwn(monitor.links(), target) ? monitor.links()[target] : null;
        if (!link) return sendJSON(res, 400, { error: '열 수 없는 주소입니다.' });
        openUrl(link); return sendJSON(res, 200, { opened: true });
      }
      const artifact = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (artifact && req.method === 'GET') {
        const [, id, genId, encoded] = artifact; const name = decodeURIComponent(encoded);
        const item = getCase(id); const gen = item.generations?.find(g => g.id === genId);
        if (!gen?.artifacts.some(a => a.name === name)) return sendJSON(res, 404, { error: '생성 파일을 찾을 수 없습니다.' });
        const file = childPath(caseDir(id), '생성 이력', genId, name);
        const stat = await fs.stat(file); res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
        return await pipeline(createReadStream(file), res);
      }
      const resultAsset = url.pathname.match(/^\/api\/cases\/([a-zA-Z0-9-]+)\/result-assets\/(ratingImage|usageGuide|certificate)$/);
      if (resultAsset && req.method === 'GET') {
        const [, id, kind] = resultAsset; requireOnlineCase(id);
        const asset = await remote.downloadAsset(id, kind);
        res.setHeader('Content-Type', asset.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(asset.filename || kind))}`);
        if (asset.contentLength && /^\d+$/.test(String(asset.contentLength))) res.setHeader('Content-Length', asset.contentLength);
        return await pipeline(Readable.fromWeb(asset.body), res);
      }
      const route = url.pathname.match(/^\/api\/cases\/([a-zA-Z0-9-]+)(?:\/(local|generate|download|open|attachments|results|certificate|email-preview|reference|translate|restore))?$/);
      if (!route) return sendJSON(res, 404, { error: '요청을 찾을 수 없습니다.' });
      const [, id, action] = route; const item = getCase(id, action === 'restore' || req.method === 'DELETE');
      if (!action && req.method === 'DELETE') {
        if (activeOperations.get(id) || store.data.jobs.some(j => j.caseId === id && ['queued', 'running'].includes(j.status))) return sendJSON(res, 409, { error: '진행 중인 작업이 있습니다. 완료된 뒤 휴지통으로 이동하세요.', code: 'CASE_BUSY' });
        if (!item.deletedAt) { item.deletedAt = now(); store.audit(id, 'delete', '이 Mac의 휴지통으로 이동했습니다. 서비스 신청과 보관 파일은 유지됩니다.'); await store.save(); }
        return sendJSON(res, 200, { ok: true, deletedAt: item.deletedAt });
      }
      if (action === 'restore' && req.method === 'POST') {
        if (item.purgeRequestedAt) return sendJSON(res, 409, { error: '영구 삭제가 시작된 항목입니다. 휴지통 비우기를 다시 실행해 남은 자료를 정리하세요.', code: 'PURGE_PENDING' });
        if (item.deletedAt) { delete item.deletedAt; if (item.source !== 'manual') item.detailStale = true; store.audit(id, 'restore', '휴지통의 신청을 복원했습니다.'); await store.save(); }
        return sendJSON(res, 200, { ok: true });
      }
      if (['POST', 'PATCH'].includes(req.method)) { activeCaseId = id; activeOperations.set(id, (activeOperations.get(id) || 0) + 1); }
      if (!action && req.method === 'GET') return sendJSON(res, 200, await detail(id));
      if (action === 'translate' && req.method === 'POST') {
        if (item.source !== 'manual') return sendJSON(res, 400, { error: '수동 작업의 미번역 가사만 이 기능으로 보완할 수 있습니다.' });
        const input = await readJSON(req), current = await detail(id);
        if (!input.expectedSourceHash || input.expectedSourceHash !== current.screening?.sourceHash) return sendJSON(res, 409, { error: '가사 내용이 변경되었습니다. 최신 내용을 확인한 후 번역하세요.' });
        const previousOverrides = JSON.stringify(item.local.overrides || {});
        const result = await translator({ detail: current, serviceUrl: process.env.ONSIDE_DESK_SERVICE_URL, signal: shutdown.signal });
        const latest = await detail(id);
        if (latest.screening?.sourceHash !== current.screening?.sourceHash || JSON.stringify(item.local.overrides || {}) !== previousOverrides) return sendJSON(res, 409, { error: '번역 중 문서 내용이 변경되어 번역 결과를 적용하지 않았습니다. 현재 내용을 확인하세요.' });
        if (result.translatedCount > 0) {
          item.local = validateLocalPatch({ overrides: result.overrides, reviewAcknowledgedRevision: '' }, item.local, latest.tracks.map(t => t.id));
          item.sourceChanged = !!item.generations?.length; item.submission.updated_at = now(); item.detail.submission.updated_at = item.submission.updated_at;
          store.audit(id, 'translate', `미번역 가사 ${result.translatedCount}개 구간을 번역했습니다. 기존 원문은 기준파일에 보존됩니다.`); await store.save();
        }
        return sendJSON(res, 200, { detail: await detail(id), translatedCount: result.translatedCount || 0, warnings: result.warnings || [] });
      }
      if (['results', 'email-preview', 'certificate'].includes(action)) requireOnlineCase(id);
      if (action === 'reference' && req.method === 'GET') {
        if (item.source !== 'manual' || !item.importInfo?.filename) return sendJSON(res, 404, { error: '수동 작업 기준파일을 찾을 수 없습니다.' });
        const file = childPath(caseDir(id), '기준파일', item.importInfo.filename);
        const stat = await fs.stat(file); res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.importInfo.filename)}`);
        return await pipeline(createReadStream(file), res);
      }
      if (action === 'results' && req.method === 'GET') return sendJSON(res, 200, await remote.getResults(id));
      if (action === 'email-preview' && req.method === 'GET') return sendJSON(res, 200, await remote.getEmailPreview(id));
      if (action === 'results' && req.method === 'POST') {
        const result = await remote.saveResults(id, await readJSON(req));
        return sendJSON(res, 200, await afterRemoteSave(id, result, '서비스 심의 결과를 저장했습니다.'));
      }
      if (action === 'certificate' && req.method === 'POST') {
        const result = await remote.uploadCertificate(id, { body: await readCertificate(req), filename: url.searchParams.get('filename'), expectedUpdatedAt: url.searchParams.get('expectedUpdatedAt'), requestId: url.searchParams.get('requestId') });
        return sendJSON(res, 200, await afterRemoteSave(id, result, '영등위 필증을 서비스에 등록했습니다.'));
      }
      if (action === 'local' && req.method === 'PATCH') {
        const current = await detail(id);
        const patch = await readJSON(req);
        if (item.source === 'manual' && patch.reviewAcknowledgedRevision && patch.reviewAcknowledgedRevision !== current.screening?.sourceHash) return sendJSON(res, 409, { error: '가사 내용이 변경되었습니다. 현재 검토사항을 다시 확인하세요.' });
        item.local = validateLocalPatch(patch, item.local, current.tracks.map(t => t.id));
        if (item.source === 'manual' && patch.overrides) { item.sourceChanged = !!item.generations?.length; item.submission.updated_at = now(); item.detail.submission.updated_at = item.submission.updated_at; }
        store.audit(id, 'edit', '로컬 진행 상태·메모·문서 내용을 저장했습니다.'); await store.save(); return sendJSON(res, 200, { local: item.local, ...(item.source === 'manual' ? { detail: await detail(id) } : {}) });
      }
      if (['generate', 'download'].includes(action) && req.method === 'POST') return sendJSON(res, 202, { job: enqueue(id, action) });
      if (action === 'open' && req.method === 'POST') {
        const { target } = await readJSON(req);
        const dir = target === 'latest' && item.generations?.length ? path.join(caseDir(id), '생성 이력', item.generations.at(-1).id) : caseDir(id);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 }); openFolder(dir); return sendJSON(res, 200, { opened: true });
      }
      if (action === 'attachments' && req.method === 'POST') {
        const name = safeName(url.searchParams.get('filename'));
        const attachmentId = randomUUID(); const dir = path.join(caseDir(id), '이메일 파일'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const filename = path.join(dir, `${attachmentId.slice(0, 8)}_${name}`); let bytes = 0;
        const limit = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > 20 * 1024 ** 3 ? new Error('한 파일은 20GB까지 추가할 수 있습니다.') : null, chunk); } });
        try { await pipeline(req, limit, createWriteStream(`${filename}.part`, { flags: 'wx', mode: 0o600 })); await fs.rename(`${filename}.part`, filename); }
        catch (error) { await fs.unlink(`${filename}.part`).catch(() => {}); throw error; }
        const attachment = { id: attachmentId, name, storedName: path.basename(filename), bytes, createdAt: now(), sha256: await sha256(filename) };
        item.attachments ||= []; item.attachments.push(attachment); store.audit(id, 'attachment', `로컬 파일 추가: ${name}`); await store.save(); return sendJSON(res, 200, { attachment });
      }
      return sendJSON(res, 405, { error: '지원하지 않는 요청입니다.' });
    } catch (error) { if (!res.headersSent) sendJSON(res, error.httpStatus || error.status || 400, { error: safeError(error), code: error.code }); else res.destroy(); }
    finally { if (activeCaseId) { const remaining = (activeOperations.get(activeCaseId) || 1) - 1; if (remaining) activeOperations.set(activeCaseId, remaining); else activeOperations.delete(activeCaseId); } }
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 20000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let timer, monitorTimer;
  if (timers) {
    // Background checks keep notifications working while the window is closed.
    monitorTimer = setInterval(() => { void runMonitor(false).catch(() => {}); }, 10 * 60 * 1000); monitorTimer.unref();
    setTimeout(() => { void runMonitor(false).catch(() => {}); }, 10_000).unref();
    timer = setInterval(() => { if (store.data.settings.autoSync) void sync().catch(() => {}); }, 5 * 60 * 1000); timer.unref();
    if (store.data.settings.autoSync && source.sourceStatus().configured) void sync().catch(() => {});
  }
  return { server, store, sync, detail, enqueue, backup, publicState, outputRoot, token, async idle() { await queue; }, async close() { closing = true; clearInterval(timer); clearInterval(monitorTimer); shutdown.abort(); await queue.catch(() => {}); await store.save(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createDesk().then(desk => {
    console.log(`Onside Review Desk ready at http://127.0.0.1:${desk.server.address().port}`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void desk.close().then(() => process.exit(0)); });
  }).catch(() => { console.error('Onside Review Desk could not start. Check the local data file, connection settings, and port 43127.'); process.exit(1); });
}
