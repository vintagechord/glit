import fs from 'node:fs/promises';
import path from 'node:path';

// Owner decision 2026-11-20: the files a customer submitted are kept for 7 days
// after the result notice, then deleted from the service (B2) and this Mac.
export const CUSTOMER_FILE_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const FINISHED_STATUSES = new Set(['RESULT_READY', 'COMPLETED']);
// download() writes this note next to the originals; it is the desk's own record.
const RECEIPT_NOTE = '파일 수신 현황.txt';

/**
 * When the customer's files stop being kept: 7 days after the result notice of
 * a paid review that is fully finished. Null otherwise — including an album
 * sent on to 결과 통보 완료 while a station is still pending, which stays
 * IN_PROGRESS until its last result is saved and the result notice goes out.
 */
export function customerFilesExpireAt(submission) {
  if (submission?.payment_status !== 'PAID' || !FINISHED_STATUSES.has(submission.status)) return null;
  const notified = Date.parse(submission.result_notified_at ?? '');
  return Number.isFinite(notified) ? new Date(notified + CUSTOMER_FILE_RETENTION_DAYS * DAY_MS).toISOString() : null;
}

/**
 * Deletes what the customer submitted that this Mac holds for one case: the
 * downloaded originals (원본 파일, except the receipt note) and the files added
 * from the customer's e-mail (이메일 파일). Generated documents stay.
 */
export async function removeCustomerFiles(caseDirectory) {
  let files = 0, bytes = 0;
  for (const folder of ['원본 파일', '이메일 파일']) {
    const directory = path.join(caseDirectory, folder);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (folder === '원본 파일' && entry.name.normalize('NFC') === RECEIPT_NOTE) continue;
      const target = path.join(directory, entry.name);
      if (entry.isFile()) { bytes += (await fs.stat(target)).size; files += 1; }
      await fs.rm(target, { recursive: true, force: true });
    }
  }
  return { files, bytes };
}
