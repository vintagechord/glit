import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SUBMISSION_FILE_RECEIPT_MISSING_MESSAGE,
  submissionCommitErrorMessage,
} from "../src/lib/submission-save-errors";

// A listed file whose upload receipt is gone (a save that ran while it was
// finishing, or a browser copy restored after the 7-day staging expiry) made
// every later save fail with the generic message, which never said what to do.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a missing or mismatched upload receipt asks the applicant to upload that file again", () => {
  for (const message of ["SUBMISSION_FILE_METADATA_UNVERIFIED", "SUBMISSION_FILE_METADATA_MISMATCH"]) {
    assert.equal(submissionCommitErrorMessage({ message, code: "P0001" }), SUBMISSION_FILE_RECEIPT_MISSING_MESSAGE);
  }
  assert.match(SUBMISSION_FILE_RECEIPT_MISSING_MESSAGE, /삭제한 뒤 다시 올려주세요/);
});

test("other commit failures keep the generic message", () => {
  const generic = "접수 저장이 완료되지 않았습니다. 내용을 확인한 뒤 다시 시도해주세요.";
  assert.equal(submissionCommitErrorMessage(null), generic);
  assert.equal(submissionCommitErrorMessage({ message: "deadlock detected", code: "40P01" }), generic);
});

test("album and MV saves both report commit failures through the shared message", () => {
  const source = read("src/features/submissions/actions.ts");
  assert.equal(source.match(/error: submissionCommitErrorMessage\(commitError\)/g)?.length, 2);
  assert.doesNotMatch(source, /error: "접수 저장이 완료되지 않았습니다/);
});

test("English pages translate the new message", () => {
  const pack = read("src/components/i18n/english-language-pack.tsx");
  assert.ok(pack.includes(JSON.stringify(SUBMISSION_FILE_RECEIPT_MISSING_MESSAGE)));
});

test("the album wizard never sends its file list while an upload is finishing", () => {
  const source = read("src/features/submissions/album-wizard.tsx");
  assert.match(source, /const includeFiles = !uploadInProgress && \(uploadsReady \|\| uploadedFiles\.length > 0 \|\| emailSubmitConfirmed\);/);
});
