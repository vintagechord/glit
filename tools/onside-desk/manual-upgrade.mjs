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
