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
import { upgradeManualMvCases, upgradeManualReferenceCleanup } from './manual-upgrade.mjs';
import { needsLyricsTranslation } from './manual-translation.mjs';
import { Store, now, safeName, childPath, atomicJSON, sha256, zipFiles, applyOverrides, caseWarnings, validateLocalPatch, validateSettings } from './core.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'Onside Review Desk');
// The app window keeps the page (and its token) open across service restarts
// and updates, so the token is kept in the private data folder instead of
// changing on every start, which left an open window failing every request.
async function sessionToken(dataRoot) {
  const file = path.join(dataRoot, 'session.key');
  const saved = await fs.readFile(file, 'utf8').then(value => value.trim()).catch(() => '');
  if (/^[0-9a-f]{64}$/.test(saved)) return saved;
  const token = randomBytes(32).toString('hex');
  await fs.writeFile(file, `${token}\n`, { mode: 0o600 });
  await fs.chmod(file, 0o600);
  return token;
}

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
  await upgradeManualReferenceCleanup({ store, outputRoot, importer });
  const token = await sessionToken(dataRoot);
  let connected = false, syncPromise, queue = Promise.resolve(), closing = false;
  const shutdown = new AbortController();
  const caseDir = id => childPath(outputRoot, id);
  const activeOperations = new Map();
  let emptyingTrash = false;
  let purgingStorage = false;
  const getCase = (id, includeDeleted = false) => { const item = Object.hasOwn(store.data.cases, id) && store.data.cases[id]; if (!item) throw Object.assign(new Error('신청 내역을 찾을 수 없습니다. 먼저 동기화하세요.'), { status: 404 }); if (item.deletedAt && !includeDeleted) throw Object.assign(new Error('휴지통으로 이동한 신청입니다. 복원한 뒤 작업하세요.'), { status: 410, code: 'CASE_DELETED' }); return item; };
  const safeError = error => error?.message && !/(?:eyJ[A-Za-z0-9_-]{20}|https?:|secret|credential|Bearer)/i.test(error.message) ? error.message.slice(0, 500) : '작업에 실패했습니다. 연결 설정과 저장 공간을 확인한 뒤 다시 시도하세요.';
  function summary(item) {
    const s = item.source === 'manual' ? applyOverrides(item.detail, item.local).submission : item.submission;
    return { id: s.id, source: item.source || 'online', online: !!item.online?.submissionId, deletedAt: item.deletedAt || null, purgePending: !!item.purgeRequestedAt, type: s.type, title: s.title, artist_name: s.artist_name, applicant_name: s.applicant_name, created_at: s.created_at, updated_at: s.updated_at, release_date: s.release_date, status: s.status, payment_status: s.payment_status, files_submitted_by_email: s.files_submitted_by_email, local: item.local, warnings: item.detail ? caseWarnings({ ...item.detail, localAttachments: item.attachments || [] }, item.local) : [], latestGeneration: item.generations?.at(-1) || null, sourceChanged: !!item.sourceChanged };
  }
  function publicState() {
    const cases = Object.values(store.data.cases).map(summary).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { monitor: monitorState.snapshot ? { overall: monitorState.snapshot.overall, issues: monitorState.snapshot.issues.length, checkedAt: monitorState.snapshot.checkedAt } : null, connection: { ...source.sourceStatus(), connected, resultsConfigured: remote.configured(), message: connected ? remote.configured() ? '온사이드 관리자 연동' : '신청 조회 연결 · 결과 연동 설정 필요' : store.data.syncError || '연결 대기 중' }, settings: store.data.settings, lastSync: store.data.lastSync, syncError: store.data.syncError, syncing: !!syncPromise, cases: cases.filter(c => !c.deletedAt), trashCases: cases.filter(c => c.deletedAt), jobs: store.data.jobs.filter(j => !store.data.cases[j.caseId]?.deletedAt).slice(0, 60), outputRoot, version: '2.9.0' };
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
      ...(item.source === 'manual' ? { online: item.online || null, importInfo: item.importInfo, screening: { ...screening, acknowledged: !!screening?.sourceHash && item.local.reviewAcknowledgedRevision === screening.sourceHash } } : {}) };
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
      const importInfo = { parserVersion: 5, filename: originalName, format: imported.format, warnings: imported.warnings || [], extractedText: imported.extractedText, importedAt: timestamp, bytes: body.length, sha256: await sha256(originalPath) };
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
        const linked = new Map(Object.values(store.data.cases).filter(c => c.online?.submissionId).map(c => [c.online.submissionId, c]));
        for (const submission of submissions) {
          if (Object.hasOwn(store.data.purgedCases, submission.id)) continue;
          const owner = linked.get(submission.id);
          if (owner) { Object.assign(owner.online, { status: submission.status, payment_status: submission.payment_status, updated_at: submission.updated_at }); continue; }
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
  /**
   * Whether this Mac holds every listed upload of a submission: the original
   * downloaded by 심의 자료 생성/원본 다운로드, at the recorded path, with the
   * recorded and the service's byte size. Matching goes file id → the case's
   * asset → its object key → the download record.
   */
  async function localCopyStatus(submissionId, files) {
    const item = store.data.cases[submissionId];
    if (!item || item.deletedAt || item.source === 'manual') return { complete: false, missing: files.length, noCase: true, reason: '이 Mac에 신청이 없습니다. 신청 관리에서 새로고침한 뒤 원본을 받으세요.' };
    const assets = item.detail?.assets || [];
    const directory = path.join(caseDir(submissionId), '원본 파일');
    let missing = 0;
    for (const file of files) {
      const asset = assets.find(candidate => candidate.id === file.id);
      const key = asset && (asset.objectKey || asset.file_path || asset.path || asset.id);
      const record = key && (item.downloads || []).find(download => download.sourceKey === key);
      let stat = null;
      if (record) { try { stat = await fs.stat(childPath(directory, record.name)); } catch { stat = null; } }
      if (!record || !stat?.isFile() || stat.size !== record.bytes || (file.sizeBytes && stat.size !== file.sizeBytes)) missing += 1;
    }
    return missing ? { complete: false, missing, reason: `이 Mac에 원본 ${missing}개가 없습니다. 원본 받기 후 삭제할 수 있습니다.` } : { complete: true, missing: 0 };
  }
  /** 저장공간 정리 목록: finished, refunded and paid submissions still in review, with this Mac's copy state for the last. */
  async function listStorage() {
    const listed = await remote.listStorage({ scope: 'received' });
    const items = [];
    for (const item of listed.items) items.push({ ...item, local: item.stage === 'in_review' ? await localCopyStatus(item.submissionId, item.files) : { complete: true, missing: 0, notRequired: true } });
    return { items };
  }
  /** 저장공간 정리: one service batch at a time; the service re-checks every submission. */
  async function purgeStorage(input) {
    if (purgingStorage) throw Object.assign(new Error('저장공간을 정리하고 있습니다. 끝난 뒤 다시 시도하세요.'), { status: 409, code: 'STORAGE_BUSY' });
    purgingStorage = true;
    try {
      const requested = Array.isArray(input?.submissionIds) ? input.submissionIds.map(String) : [];
      // Re-read the current list and this Mac's originals right before deleting anything still in review.
      const current = new Map((await remote.listStorage({ scope: 'received' })).items.map(item => [item.submissionId, item]));
      const refused = [], allowed = [];
      for (const id of requested) {
        const item = current.get(id);
        if (!item) { refused.push({ submissionId: id, ok: false, deletedFiles: 0, failedFiles: 0, freedBytes: 0, error: '삭제할 고객 파일이 없거나 정리 대상이 아닙니다. 목록을 새로고침하세요.' }); continue; }
        if (item.stage === 'in_review') {
          if (store.data.cases[id] && !store.data.cases[id].deletedAt) await detail(id, true).catch(() => {});
          const local = await localCopyStatus(id, item.files);
          if (!local.complete) { refused.push({ submissionId: id, ok: false, deletedFiles: 0, failedFiles: 0, freedBytes: 0, error: local.reason }); continue; }
        }
        allowed.push(id);
      }
      const result = allowed.length
        ? await remote.purgeStorage(allowed, { requestId: input?.requestId, scope: 'received', localCopiesVerified: true })
        : { ok: true, results: [] };
      result.results = [...result.results, ...refused];
      let recorded = false;
      for (const item of result.results) {
        if (!item?.deletedFiles || !Object.hasOwn(store.data.cases, item.submissionId)) continue;
        const megabytes = Math.max(1, Math.round(Number(item.freedBytes || 0) / 1024 ** 2));
        store.audit(item.submissionId, 'storage', `서비스 저장소의 고객 업로드 파일 ${item.deletedFiles}개(${megabytes}MB)를 삭제했습니다.`);
        recorded = true;
      }
      if (recorded) await store.save();
      return result;
    } finally { purgingStorage = false; }
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
    // Originals already purged from the service are no longer listed; keep their local records.
    const listedKeys = new Set(assets.map(asset => asset.objectKey || asset.file_path || asset.path || asset.id));
    const retained = (item.downloads || []).filter(record => !listedKeys.has(record.sourceKey) && !results.some(result => result.sourceKey === record.sourceKey));
    item.downloads = [...results, ...retained];
    const message = [current.submission.files_submitted_by_email ? '신청 시 이메일로 전달한 파일이 있습니다. 수신함에서 실제 파일을 확인하고 앱의 이메일 파일 추가 기능으로 보관하세요.' : '', !assets.length ? '서비스에서 다운로드할 업로드 파일을 찾지 못했습니다.' : '', ...errors].filter(Boolean).join('\n');
    await fs.writeFile(path.join(destination, '파일 수신 현황.txt'), `신청 ID: ${id}\n확인 일시: ${now()}\n\n${message}\n\n다운로드한 파일\n${results.map(r => `${r.name} (${r.bytes} bytes) SHA256 ${r.sha256}`).join('\n')}\n\n로컬 추가 파일\n${(item.attachments || []).map(a => a.name).join('\n')}`, { mode: 0o600 });
    store.audit(id, 'download', `${results.length}개 원본 파일 저장${errors.length ? `, ${errors.length}개 실패` : ''}`);
    await store.save();
    return { count: results.length, warnings: message ? message.split('\n') : [], failed: errors.length };
  }
  /** Review documents always carry Korean under foreign lyrics: untranslated
   * runs are translated first and saved as this case's lyric edits. */
  async function translateBeforeGeneration(id, current, job) {
    if (!needsLyricsTranslation(current)) return { current, warnings: [] };
    const item = getCase(id);
    job.message = '미번역 가사를 번역하는 중'; await store.save();
    try {
      const result = await translator({ detail: current, serviceUrl: process.env.ONSIDE_DESK_SERVICE_URL, signal: shutdown.signal, allowOnline: true });
      if (!(result.translatedCount > 0)) return { current, warnings: result.warnings || [] };
      item.local = validateLocalPatch({ overrides: result.overrides, ...(item.source === 'manual' ? { reviewAcknowledgedRevision: '' } : {}) }, item.local, current.tracks.map(t => t.id));
      if (item.source === 'manual') { item.submission.updated_at = now(); item.detail.submission.updated_at = item.submission.updated_at; }
      store.audit(id, 'translate', `자료 생성 전에 미번역 가사 ${result.translatedCount}줄을 번역해 원문 아래 (번역: …)으로 넣었습니다.`);
      await store.save();
      return { current: await detail(id), warnings: result.warnings || [] };
    } catch (error) {
      return { current, warnings: [`미번역 가사를 자동 번역하지 못했습니다. ${safeError(error)} 번역을 확인한 뒤 자료를 다시 생성하세요.`] };
    }
  }
  async function generate(id, job) {
    const translation = await translateBeforeGeneration(id, await detail(id, true), job);
    const current = translation.current;
    const item = getCase(id);
    const generatedOverrides = JSON.stringify(item.local.overrides || {});
    const generationId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
    const dir = path.join(caseDir(id), '생성 이력', generationId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    job.message = '신청 내용과 가사로 문서를 생성하는 중'; await store.save();
    try {
      const result = await generator({ ...current, ...(item.source === 'manual' ? { files: current.localAttachments || [] } : {}), outputDir: dir, settings: store.data.settings });
      const warnings = [...new Set([...current.warnings, ...translation.warnings, ...(result.warnings || [])])];
      if (!store.data.settings.managerName || !store.data.settings.managerPhone) warnings.push('앱 설정에서 심의 담당자 이름·연락처를 입력하고 다시 생성하세요.');
      // The documents and the online application must say the same thing.
      if (item.source === 'manual' && item.online?.submissionId) {
        try { await syncOnline(id); }
        catch (error) { warnings.push(`온라인 접수에 신청서 정보를 반영하지 못했습니다: ${safeError(error)} 결과 페이지의 ‘온라인에 반영’으로 다시 시도하세요.`); }
      }
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
  /** The service submission behind a case: an online case itself, or the guest submission a manual album was registered as. */
  function remoteCaseId(id) {
    const item = getCase(id);
    if (item.source !== 'manual') return id;
    if (item.online?.submissionId) return item.online.submissionId;
    throw Object.assign(new Error('관리자 수동 작업은 온라인 결과 페이지를 만든 뒤 결과를 저장할 수 있습니다. 신청 정보 탭에서 비회원 접수로 등록하세요.'), { status: 409, code: 'MANUAL_CASE_LOCAL_ONLY' });
  }
  const registering = new Set();
  const cut = (value, max) => { const text = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim(); return text ? text.slice(0, max) : null; };
  function isoDate(value) {
    // Reference files write 2026.11.05., 2026-11-05 or 2026년 11월 5일; trailing punctuation is not part of the date.
    const match = String(value || '').trim().replace(/[.\s]+$/, '').match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
  }
  /** A reference file may print both labels ("솔로/그룹"); only an unambiguous one is sent. */
  function artistTypeOf(value) {
    const text = String(value || '').trim();
    // A reference file may leave the field's own hint ("그룹일 경우 팀원이름을 적어주세요.") in place of a value.
    if (!text || text.length > 20 || /적어|주세요|기입|경우|선택|없을/.test(text)) return null;
    const group = /그룹|밴드|듀오|팀|group|band|duo/i.test(text), solo = /솔로|개인|solo/i.test(text);
    return group && !solo ? 'GROUP' : solo && !group ? 'SOLO' : null;
  }
  /** The application details of an album case in the service's album-info shape. */
  function albumInfoPayload(effective) {
    const s = effective.submission || {}, wbs = new Set((s.wbs_track_numbers || []).map(Number));
    const tracks = (effective.tracks || []).filter(track => cut(track.track_title, 300)).map((track, index) => ({
      trackNo: Number(track.track_no) || index + 1,
      trackTitle: cut(track.track_title, 300), performer: cut(track.performer, 300), featuring: cut(track.featuring, 300), composer: cut(track.composer, 300),
      lyricist: cut(track.lyricist, 300), arranger: cut(track.arranger, 300), lyrics: cut(track.lyrics, 30000), translatedLyrics: cut(track.translated_lyrics, 30000),
      isTitle: !!track.is_title, broadcastSelected: wbs.has(Number(track.track_no)),
    }));
    return {
      submission: {
        title: cut(s.title, 200), artistName: cut(s.artist_name, 200), artistNameEn: cut(s.artist_name_en, 200), releaseDate: isoDate(s.release_date),
        genre: cut(s.genre, 100), distributor: cut(s.distributor || s.distributor_name, 200), productionCompany: cut(s.production_company, 200),
        previousRelease: cut(s.previous_release, 500), artistType: artistTypeOf(s.artist_type), artistMembers: cut(s.members || s.artist_members, 1000),
      },
      tracks,
    };
  }
  function intakePayload(effective, input) {
    const s = effective.submission || {}, info = albumInfoPayload(effective);
    return {
      packageId: input.packageId, paid: input.paid,
      guest: { name: input.guestName, phone: input.guestPhone || null, email: input.guestEmail || null },
      submission: {
        ...info.submission,
        applicantName: cut(s.applicant_name, 80), applicantEmail: cut(s.applicant_email, 200), applicantPhone: cut(s.applicant_phone, 40),
        adminMemo: '관리자 수동 작업(심의 데스크)에서 등록한 비회원 접수',
      },
      tracks: info.tracks.map(({ trackNo: _trackNo, ...track }) => { void _trackNo; return track; }),
    };
  }
  /** 신청서 정보 온라인 반영: pushes the manual case's current album details and tracks to its
   * registered submission so the admin page and the customer's application view match the documents. */
  async function syncOnline(id) {
    const item = getCase(id);
    if (item.source !== 'manual' || !item.online?.submissionId) throw Object.assign(new Error('온라인 결과 페이지를 만든 수동 음반 작업만 신청서 정보를 반영할 수 있습니다.'), { status: 409, code: 'MANUAL_CASE_LOCAL_ONLY' });
    const payload = albumInfoPayload(applyOverrides(item.detail, item.local));
    if (!payload.submission.title || !payload.submission.artistName) throw Object.assign(new Error('앨범 제목과 아티스트명을 먼저 입력하세요.'), { status: 400 });
    try {
      const result = await remote.saveAlbumInfo(item.online.submissionId, payload);
      const info = result.albumInfo || {};
      item.online.infoSyncedAt = now(); item.online.infoSyncError = null;
      if (result.changed) store.audit(id, 'online', `온라인 접수에 신청서 정보를 반영했습니다 (항목 ${(info.updatedFields || []).length}개, 트랙 수정 ${info.updatedTracks || 0}곡, 추가 ${info.insertedTracks || 0}곡).`);
      await store.save();
      return { online: item.online, changed: result.changed === true, albumInfo: info };
    } catch (error) {
      item.online.infoSyncError = safeError(error); await store.save();
      throw error;
    }
  }
  /** 관리자 대리 접수: registers a manual album case as a guest submission with a result page and lookup code. */
  async function registerOnline(id, input) {
    const item = getCase(id);
    if (item.source !== 'manual') throw Object.assign(new Error('온라인 신청은 이미 서비스에 등록되어 있습니다.'), { status: 409 });
    if (item.online?.submissionId) return { online: item.online, detail: await detail(id) };
    const effective = applyOverrides(item.detail, item.local);
    if (effective.submission?.type !== 'ALBUM') throw Object.assign(new Error('음반 수동 작업만 비회원 접수로 등록할 수 있습니다.'), { status: 400 });
    const guestName = cut(input?.guestName, 80), guestPhone = cut(input?.guestPhone, 40), guestEmail = cut(input?.guestEmail, 200);
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(input?.packageId || ''))) throw Object.assign(new Error('심의 패키지를 선택하세요.'), { status: 400 });
    if (!guestName) throw Object.assign(new Error('고객 이름을 입력하세요.'), { status: 400 });
    if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) throw Object.assign(new Error('고객 이메일 형식을 확인하세요.'), { status: 400 });
    if (typeof input?.paid !== 'boolean') throw Object.assign(new Error('결제 상태를 선택하세요.'), { status: 400 });
    const payload = intakePayload(effective, { packageId: input.packageId, paid: input.paid, guestName, guestPhone, guestEmail });
    if (!payload.submission.title || !payload.submission.artistName) throw Object.assign(new Error('앨범 제목과 아티스트명을 먼저 입력하세요. 자료 준비 → 문서 정보 수정에서 보완할 수 있습니다.'), { status: 400 });
    if (!payload.tracks.length) throw Object.assign(new Error('곡 제목이 있는 트랙이 1곡 이상 필요합니다.'), { status: 400 });
    if (registering.has(id)) throw Object.assign(new Error('등록하고 있습니다. 잠시 후 다시 확인하세요.'), { status: 409, code: 'INTAKE_BUSY' });
    registering.add(id);
    try {
      // Keep the request ID until it succeeds: it is the lookup code, so a retry returns the same submission.
      item.onlineRequest ||= { requestId: randomUUID(), startedAt: now() };
      await store.save();
      const result = await remote.registerGuestAlbum(payload, { requestId: item.onlineRequest.requestId });
      item.online = { submissionId: result.submissionId, guestToken: result.guestToken, trackUrl: result.trackUrl, paid: result.paid, registeredAt: now(), status: result.paid ? 'PRE_REVIEW' : 'SUBMITTED', payment_status: result.paid ? 'PAID' : 'UNPAID' };
      delete item.onlineRequest;
      const twin = store.data.cases[result.submissionId];
      if (twin && twin.source !== 'manual' && !twin.generations?.length && !twin.attachments?.length) delete store.data.cases[result.submissionId];
      store.audit(id, 'online', `온사이드에 비회원 음반 접수로 등록하고 결과 페이지를 만들었습니다${result.paid ? ' (결제 완료로 등록)' : ' (고객 결제 대기)'}.`);
      await store.save();
      return { online: item.online, detail: await detail(id) };
    } finally { registering.delete(id); }
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
      if (url.pathname === '/health' && req.method === 'GET') return sendJSON(res, 200, { app: 'onside-review-desk', version: '2.9.0' });
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
      if (url.pathname === '/api/storage' && req.method === 'GET') return sendJSON(res, 200, await listStorage());
      if (url.pathname === '/api/intake/packages' && req.method === 'GET') return sendJSON(res, 200, await remote.listIntakePackages());
      if (url.pathname === '/api/storage/purge' && req.method === 'POST') return sendJSON(res, 200, await purgeStorage(await readJSON(req)));
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
        const [, id, kind] = resultAsset;
        const asset = await remote.downloadAsset(remoteCaseId(id), kind);
        res.setHeader('Content-Type', asset.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(asset.filename || kind))}`);
        if (asset.contentLength && /^\d+$/.test(String(asset.contentLength))) res.setHeader('Content-Length', asset.contentLength);
        return await pipeline(Readable.fromWeb(asset.body), res);
      }
      const route = url.pathname.match(/^\/api\/cases\/([a-zA-Z0-9-]+)(?:\/(local|generate|download|open|attachments|results|certificate|email-preview|reference|translate|restore|register-online|open-online|sync-online))?$/);
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
      const rid = ['results', 'email-preview', 'certificate'].includes(action) ? remoteCaseId(id) : id;
      if (action === 'register-online' && req.method === 'POST') return sendJSON(res, 200, await registerOnline(id, await readJSON(req)));
      if (action === 'sync-online' && req.method === 'POST') { const synced = await syncOnline(id); return sendJSON(res, 200, { ...synced, detail: await detail(id) }); }
      if (action === 'open-online' && req.method === 'POST') {
        if (!item.online?.trackUrl || !/^https:\/\//.test(item.online.trackUrl)) return sendJSON(res, 404, { error: '온라인 결과 페이지가 없습니다.' });
        openUrl(item.online.trackUrl); return sendJSON(res, 200, { opened: true });
      }
      if (action === 'reference' && req.method === 'GET') {
        if (item.source !== 'manual' || !item.importInfo?.filename) return sendJSON(res, 404, { error: '수동 작업 기준파일을 찾을 수 없습니다.' });
        const file = childPath(caseDir(id), '기준파일', item.importInfo.filename);
        const stat = await fs.stat(file); res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.importInfo.filename)}`);
        return await pipeline(createReadStream(file), res);
      }
      if (action === 'results' && req.method === 'GET') {
        const snapshot = await remote.getResults(rid);
        // Asset links point at the local case, which for a registered manual album is not the service ID.
        if (rid !== id) for (const asset of snapshot.assets?.items || []) if (asset.downloadUrl) asset.downloadUrl = asset.downloadUrl.replace(`/api/cases/${rid}/`, `/api/cases/${id}/`);
        return sendJSON(res, 200, snapshot);
      }
      if (action === 'email-preview' && req.method === 'GET') return sendJSON(res, 200, await remote.getEmailPreview(rid));
      if (action === 'results' && req.method === 'POST') {
        const result = await remote.saveResults(rid, await readJSON(req));
        return sendJSON(res, 200, await afterRemoteSave(id, result, '서비스 심의 결과를 저장했습니다.'));
      }
      if (action === 'certificate' && req.method === 'POST') {
        const result = await remote.uploadCertificate(rid, { body: await readCertificate(req), filename: url.searchParams.get('filename'), expectedUpdatedAt: url.searchParams.get('expectedUpdatedAt'), requestId: url.searchParams.get('requestId') });
        return sendJSON(res, 200, await afterRemoteSave(id, result, '영등위 필증을 서비스에 등록했습니다.'));
      }
      if (action === 'local' && req.method === 'PATCH') {
        const current = await detail(id);
        const patch = await readJSON(req);
        if (item.source === 'manual' && patch.reviewAcknowledgedRevision && patch.reviewAcknowledgedRevision !== current.screening?.sourceHash) return sendJSON(res, 409, { error: '가사 내용이 변경되었습니다. 현재 검토사항을 다시 확인하세요.' });
        item.local = validateLocalPatch(patch, item.local, current.tracks.map(t => t.id));
        if (item.source === 'manual' && patch.overrides) { item.sourceChanged = !!item.generations?.length; item.submission.updated_at = now(); item.detail.submission.updated_at = item.submission.updated_at; }
        store.audit(id, 'edit', '로컬 진행 상태·메모·문서 내용을 저장했습니다.'); await store.save();
        // Edited album details follow to the registered submission; the local save stands even when the service is unreachable.
        const onlineSync = item.source === 'manual' && patch.overrides && item.online?.submissionId
          ? await syncOnline(id).then(result => ({ ok: true, changed: result.changed }), error => ({ ok: false, error: safeError(error) }))
          : null;
        return sendJSON(res, 200, { local: item.local, ...(item.source === 'manual' ? { detail: await detail(id), onlineSync } : {}) });
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
