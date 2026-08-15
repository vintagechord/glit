import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getSubmissionUploadBlockReason,
  getSubmissionUploadConflictMessage,
  shouldStageSubmissionUpload,
} from "../src/lib/submission-upload-access";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("submission upload state rejects paid and non-editable lifecycle records", () => {
  assert.equal(
    getSubmissionUploadBlockReason({
      status: "SUBMITTED",
      payment_status: "PAID",
    }),
    "PAID",
  );
  assert.equal(
    getSubmissionUploadBlockReason({
      status: "IN_PROGRESS",
      payment_status: "UNPAID",
    }),
    "NOT_EDITABLE",
  );
  assert.equal(
    getSubmissionUploadBlockReason({
      status: "WAITING_PAYMENT",
      payment_status: "PAYMENT_PENDING",
    }),
    "NOT_EDITABLE",
  );

  for (const status of [
    "DRAFT",
    "PRE_REVIEW",
    "SUBMITTED",
    "WAITING_PAYMENT",
  ]) {
    assert.equal(
      getSubmissionUploadBlockReason({
        status,
        payment_status: "UNPAID",
      }),
      null,
      status,
    );
  }

  assert.equal(
    getSubmissionUploadConflictMessage(new Error("SUBMISSION_FILE_PAID")),
    "결제가 완료된 접수의 파일은 변경할 수 없습니다.",
  );
  assert.equal(
    getSubmissionUploadConflictMessage(
      new Error("SUBMISSION_FILE_STATE_INVALID"),
    ),
    "현재 상태에서는 접수 파일을 변경할 수 없습니다.",
  );
});

test("every editable applicant upload stays staged until the explicit save", () => {
  assert.equal(
    shouldStageSubmissionUpload({ status: "SUBMITTED" }),
    true,
  );
  assert.equal(
    shouldStageSubmissionUpload({ status: "WAITING_PAYMENT" }),
    true,
  );
  assert.equal(
    shouldStageSubmissionUpload({ status: "DRAFT", payment_status: "UNPAID" }),
    true,
  );
  assert.equal(
    shouldStageSubmissionUpload({
      status: "PRE_REVIEW",
      payment_status: "UNPAID",
    }),
    true,
  );

  for (const path of [
    "src/app/api/uploads/complete/route.ts",
    "src/app/api/uploads/multipart/complete/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /const staged = shouldStageSubmissionUpload\(submission\)/, path);
    assert.match(source, /staged,[\s\S]{0,120}key/, path);
    assert.match(source, /from\("submission_upload_staging"\)/, path);
    assert.doesNotMatch(
      source,
      /from\("submission_files"\)[\s\S]{0,180}\.(?:insert|update)\(/,
      `${path} must never publish applicant metadata directly`,
    );
  }
});

test("every submission upload endpoint checks lifecycle after owner lookup", () => {
  for (const path of [
    "src/app/api/uploads/init/route.ts",
    "src/app/api/uploads/presign/route.ts",
    "src/app/api/uploads/direct/route.ts",
    "src/app/api/uploads/complete/route.ts",
    "src/app/api/uploads/multipart/init/route.ts",
    "src/app/api/uploads/multipart/presign/route.ts",
    "src/app/api/uploads/multipart/complete/route.ts",
    "src/app/api/uploads/multipart/abort/route.ts",
  ]) {
    const source = read(path);
    const ownerLookup = source.indexOf("ensureSubmissionOwner(");
    const stateGuard = source.indexOf("getSubmissionUploadBlockReason(");
    assert.ok(ownerLookup >= 0, `${path} must verify ownership`);
    assert.ok(
      stateGuard > ownerLookup,
      `${path} must enforce lifecycle after ownership`,
    );
    assert.match(source, /(?:status:\s*409|,\s*409\s*[,\)])/, path);
  }
});

test("database trigger serializes file writes with parent payment state", () => {
  const migration = read(
    "supabase/migrations/0091_guard_submission_file_edit_state.sql",
  );
  assert.match(migration, /from public\.submissions[\s\S]*for update/);
  assert.match(migration, /v_payment_status = 'PAID'/);
  assert.match(
    migration,
    /v_status not in \([\s\S]*'DRAFT'[\s\S]*'PRE_REVIEW'[\s\S]*'SUBMITTED'[\s\S]*'WAITING_PAYMENT'/,
  );
  assert.match(
    migration,
    /before insert or update[\s\S]*on public\.submission_files/,
  );
  assert.match(migration, /create table if not exists public\.submission_upload_staging/);
  assert.match(migration, /cleanup_committed_submission_upload_staging/);
  assert.match(migration, /SUBMISSION_FILE_SAVE_LEASE_REQUIRED/);
  assert.match(migration, /SUBMISSION_FILE_METADATA_UNVERIFIED/);
  assert.match(migration, /SUBMISSION_FILE_METADATA_MISMATCH/);
  assert.match(migration, /stage_submission_file_before_replace/);
  assert.match(migration, /promote_verified_submission_etc_upload/);
  assert.match(
    migration,
    /p_payment_document_type[\s\S]*TAX_INVOICE[\s\S]*staged\.kind = 'ETC'[\s\S]*staged\.purpose = 'PAYMENT_DOCUMENT'/,
  );
  assert.match(
    migration,
    /v_verified\.original_name is distinct from new\.original_name[\s\S]*v_verified\.size is distinct from new\.size/,
  );
  assert.match(migration, /new\.mime := v_verified\.mime/);

  const atomicMigration = read(
    "supabase/migrations/0089_atomic_submission_parent_save.sql",
  );
  assert.match(
    atomicMigration,
    /promote_verified_submission_etc_upload\(uuid,jsonb,text\)[\s\S]*p_parent->>'payment_document_type'/,
  );
});

test("draft resume safely merges live and staged files with live path priority", () => {
  const draftsRoute = read("src/app/api/submissions/drafts/route.ts");
  const liveQuery = draftsRoute.indexOf('.from("submission_files")');
  const stagedQuery = draftsRoute.indexOf('.from("submission_upload_staging")');
  const merge = draftsRoute.indexOf("fileRows = [", stagedQuery);

  assert.ok(liveQuery >= 0);
  assert.ok(stagedQuery > liveQuery);
  assert.ok(merge > stagedQuery);
  assert.match(
    draftsRoute.slice(merge, merge + 220),
    /fileRows = \[\s*\.\.\.fileRows,[\s\S]*stagedFileResult\.data/,
  );
  assert.match(
    draftsRoute,
    /const objectPath = String\(row\.object_key \?\? row\.file_path/,
  );
  assert.match(
    draftsRoute,
    /from\("submission_upload_staging"\)[\s\S]*\.eq\("purpose", "SUBMISSION_FILE"\)/,
  );

  const etcUpload = read("src/lib/submission-etc-upload.ts");
  assert.match(etcUpload, /purpose: "PAYMENT_DOCUMENT"/);

  const cleanup = read("src/lib/submission-file-cleanup.ts");
  assert.match(cleanup, /from\("submission_upload_staging"\)/);
  const actions = read("src/features/submissions/actions.ts");
  assert.match(
    actions,
    /loadSubmissionB2ObjectRefs\([\s\S]*commit_submission_save_v2[\s\S]*scheduleReplacedSubmissionFileCleanup/,
  );
});
