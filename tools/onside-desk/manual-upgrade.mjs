import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, childPath, now, sha256 } from './core.mjs';

// Re-read the preserved reference after the qualified-label parser fix. Work
// remains local; explicitly changed values and all existing output stay intact.
export async function upgradeManualMvCases({ store, outputRoot, importer }) {
  const pending = Object.entries(store.data.cases).filter(([, item]) => item.source === 'manual' && item.submission?.type !== 'ALBUM' && item.importInfo?.filename && (item.importInfo.parserVersion || 0) < 3);
  if (!pending.length) return;
  await atomicJSON(path.join(store.root, '자동백업', `수동뮤비-2.3-변환전-${Date.now()}.json`), store.data);
  for (const [id, item] of pending) {
    try {
      const file = childPath(outputRoot, id, '기준파일', item.importInfo.filename);
      if ((await fs.stat(file)).size > 20 * 1024 * 1024) throw new Error('보관 기준파일 크기를 확인하세요.');
      if (item.importInfo.sha256 && await sha256(file) !== item.importInfo.sha256) throw new Error('보관 기준파일이 변경되어 자동 재추출을 건너뛰었습니다.');
      const parsed = await importer({ body: await fs.readFile(file), filename: item.importInfo.filename, type: item.submission.type });
      const old = item.detail.submission;
      const overrides = { ...item.local.overrides?.submission };
      for (const key of Object.keys(parsed.submission)) {
        if (Object.hasOwn(overrides, key) && (overrides[key] ?? '') === (old[key] ?? '')) delete overrides[key];
      }
      const submission = { ...old, ...parsed.submission, id: old.id, type: old.type, status: old.status, created_at: old.created_at, updated_at: now(), payment_status: old.payment_status, files_submitted_by_email: true };
      item.submission = submission; item.detail = { ...item.detail, submission, tracks: [] };
      if (item.local.overrides) item.local.overrides = { ...item.local.overrides, submission: overrides, tracks: [] };
      item.local.reviewAcknowledgedRevision = '';
      item.sourceChanged = !!item.generations?.length;
      item.importInfo = { ...item.importInfo, parserVersion: 3, repairedAt: now(), format: parsed.format, extractedText: parsed.extractedText, warnings: parsed.warnings || [] };
      store.audit(id, 'reference_repair', '기준파일의 가수명·감독·주연·줄거리를 다시 읽었습니다. 직접 수정한 내용과 기존 자료는 보존했습니다.');
    } catch (error) {
      const warning = `기준파일 재확인 필요: ${error?.code === 'ENOENT' ? '보관 원본 파일을 찾지 못했습니다.' : '원문을 다시 가져와 신청 정보와 비교해 주세요.'}`;
      item.importInfo.warnings = [...new Set([...(item.importInfo.warnings || []), warning])];
    }
  }
  await store.save();
}

// Parser 5: reference guidance and page footers no longer reach lyrics, and a
// qualifier line such as "(한글 및 영문)" is no longer read as a value. Repair
// stored manual cases the same way. Only the affected text and fields change;
// values the administrator typed differently stay as they are.
export async function upgradeManualReferenceCleanup({ store, outputRoot, importer }) {
  const pending = Object.entries(store.data.cases).filter(([, item]) => item.source === 'manual' && item.detail?.submission && (item.importInfo?.parserVersion || 0) < 5);
  if (!pending.length) return;
  const { cleanLyricRecord, isLabelHint } = await import('./reference-cleanup.mjs');
  await atomicJSON(path.join(store.root, '자동백업', `수동작업-정리-변환전-${Date.now()}.json`), store.data);
  for (const [id, item] of pending) {
    const before = JSON.stringify([item.detail, item.local?.overrides]);
    const submission = cleanLyricRecord(item.detail.submission);
    const tracks = (item.detail.tracks || []).map(cleanLyricRecord);
    const overrides = item.local?.overrides ? {
      ...item.local.overrides,
      ...(item.local.overrides.submission ? { submission: cleanLyricRecord(item.local.overrides.submission) } : {}),
      ...(item.local.overrides.tracks ? { tracks: item.local.overrides.tracks.map(cleanLyricRecord) } : {}),
    } : item.local?.overrides;
    const hinted = Object.keys(submission).filter((key) => typeof submission[key] === 'string' && isLabelHint(submission[key])
      && (!Object.hasOwn(overrides?.submission || {}, key) || overrides.submission[key] === submission[key]));
    let repaired = [];
    if (hinted.length && item.importInfo?.filename) {
      try {
        const file = childPath(outputRoot, id, '기준파일', item.importInfo.filename);
        if (item.importInfo.sha256 && await sha256(file) !== item.importInfo.sha256) throw new Error('changed');
        const parsed = await importer({ body: await fs.readFile(file), filename: item.importInfo.filename, type: submission.type });
        for (const key of hinted) {
          const value = parsed.submission?.[key];
          if (typeof value === 'string' && !isLabelHint(value)) {
            submission[key] = value;
            if (overrides?.submission && Object.hasOwn(overrides.submission, key)) delete overrides.submission[key];
            repaired.push(key);
          }
        }
      } catch {
        item.importInfo.warnings = [...new Set([...(item.importInfo.warnings || []), '기준파일 재확인 필요: 항목 안내 문구가 값으로 들어간 칸이 있습니다. 원문과 비교해 주세요.'])];
      }
    }
    item.detail = { ...item.detail, submission, tracks };
    if (item.submission) item.submission = { ...item.submission, ...submission };
    if (item.local) item.local.overrides = overrides;
    item.importInfo = { ...(item.importInfo || {}), parserVersion: 5 };
    if (JSON.stringify([item.detail, item.local?.overrides]) !== before) {
      item.local.reviewAcknowledgedRevision = '';
      item.sourceChanged = !!item.generations?.length;
      store.audit(id, 'reference_repair', `기준파일의 신청 안내문·쪽 번호를 가사에서 지웠습니다${repaired.length ? '. 항목 안내 문구가 들어간 값도 원문에서 다시 읽었습니다' : ''}. 자료를 다시 생성해 주세요.`);
    }
  }
  await store.save();
}
