import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync(
  new URL("../src/features/submissions/mv-wizard.tsx", import.meta.url),
  "utf8",
);

test("MV editing steps keep a versioned local and server checkpoint", () => {
  assert.match(wizard, /useSubmissionCheckpoint<MvCheckpointSnapshot>\(\{/);
  assert.match(wizard, /kind: "MV"/);
  assert.match(wizard, /getSubmissionCheckpointStorageKey\(/);
  assert.match(
    wizard,
    /enabled:[\s\S]*resumeChecked &&[\s\S]*Boolean\(currentSubmissionId\)/,
  );
  assert.match(wizard, /setStep\(Math\.max\(1, Math\.min\(5, snapshot\.step\)\)\)/);
  assert.match(
    wizard,
    /saveMvDraft\(\{[\s\S]*includeFiles: false,[\s\S]*background: true,[\s\S]*snapshot/,
  );
  assert.match(wizard, /initialDataIsServerState:[\s\S]*checkpointSeed/);
  assert.match(
    wizard,
    /if \(snapshot\.existingCartSubmission\) \{[\s\S]*serverSaved: false/,
  );
});

test("foreground MV draft saves are exclusive and final cart completion clears the checkpoint", () => {
  assert.match(
    wizard,
    /mvCheckpointControllerRef\.current\.runExclusive\(executeSave\)/,
  );
  assert.match(
    wizard,
    /mvCheckpointControllerRef\.current\.runExclusive\(executeSubmit\)/,
  );
  assert.match(
    wizard,
    /mvCheckpointControllerRef\.current\?\.markSaved\(\{[\s\S]*uploadedFiles: uploaded\.map/,
  );
  assert.match(
    wizard,
    /setIsSaving\(true\);[\s\S]*runExclusive\(executeSubmit\)[\s\S]*finally \{[\s\S]*setIsSaving\(false\)/,
  );
  assert.match(
    wizard,
    /if \(isSaving \|\| submitInFlightRef\.current\) return;[\s\S]*submitInFlightRef\.current = true;[\s\S]*submitInFlightRef\.current = false/,
  );
  assert.match(
    wizard,
    /if \(deferPayment\) \{[\s\S]*mvCheckpointControllerRef\.current\?\.clear\(\);[\s\S]*clearDraftStorageForSubmission\(result\.submissionId\)/,
  );
  assert.match(
    wizard,
    /if \(paymentMethod === "BANK"\) \{[\s\S]*mvCheckpointControllerRef\.current\?\.clear\(\);[\s\S]*clearDraftStorageForSubmission\(result\.submissionId\)/,
  );
});

test("resume deletion keeps its recovery keys until the exact server draft is deleted", () => {
  assert.match(
    wizard,
    /status === "DRAFT" \|\| status === "PRE_REVIEW"[\s\S]*await clearServerDrafts\(\{ ids: \[draftId\], guestToken \}\)[\s\S]*await clearCartSubmission\(draftId, guestToken\)[\s\S]*clearDraftStorageForSubmission\(draftId\)/,
  );
  assert.match(
    wizard,
    /catch \(error\) \{[\s\S]*setResumeDeleteError\([\s\S]*finally \{[\s\S]*setIsClearingResumeDrafts\(false\)/,
  );
  assert.match(wizard, /resumeDeleteError \? \([\s\S]*role="alert"/);
});

test("MV checkpoint recovery restores form values and uploaded metadata", () => {
  assert.match(wizard, /const restoreMvCheckpoint = React\.useCallback/);
  assert.match(wizard, /setTitle\(snapshot\.title\)/);
  assert.match(wizard, /setLyrics\(snapshot\.lyrics\)/);
  assert.match(wizard, /setPaymentMethod\(snapshot\.paymentMethod\)/);
  const snapshotType = wizard.slice(
    wizard.indexOf("type MvCheckpointSnapshot"),
    wizard.indexOf("type MvCheckpointController"),
  );
  assert.doesNotMatch(
    snapshotType,
    /cashReceiptPhone|cashReceiptBusinessNumber|taxInvoiceBusinessNumber/,
  );
  assert.match(wizard, /uploadedFiles: uploadedFiles\.map\(stripCheckpointAccessUrl\)/);
  assert.match(wizard, /setUploadedFiles\(restoredFiles\)/);
  assert.match(wizard, /buildUploadsFromFiles\(restoredFiles\)/);
  assert.match(wizard, /onRecover: restoreMvCheckpoint/);
  assert.match(
    wizard,
    /checkpointRestoreSourceRef\.current === "previous"[\s\S]*serverUploadedFilesRef\.current/,
  );
  assert.match(wizard, /onRevertToSaved=\{revertMvCheckpointToSaved\}/);
});

test("persisted MV files survive new uploads and background form saves", () => {
  assert.match(
    wizard,
    /let results = uploadedFiles\.map\([\s\S]*mergeSubmissionUploadMetadata\(results/,
  );
  assert.match(
    wizard,
    /areSubmissionUploadMetadataEqual\([\s\S]*snapshot\.uploadedFiles,[\s\S]*serverUploadedFilesRef\.current/,
  );
});

test("editing an MV cart item preserves its original options until one explicit confirmation", () => {
  assert.match(
    wizard,
    /restoredStatus === "SUBMITTED" \|\| restoredStatus === "WAITING_PAYMENT"/,
  );
  assert.match(wizard, /selectedOptionCodes: draftStationCodes/);
  assert.match(
    wizard,
    /existingCartSubmission: source\.existingCartSubmission/,
  );
  assert.match(
    wizard,
    /issue\.acknowledgementKey === "cart-price-change"[\s\S]*setPriceChangeAcknowledged\(true\)/,
  );
  assert.match(
    wizard,
    /if \(source\.existingCartSubmission\?\.submissionId === submissionId\) \{[\s\S]*writeDraftStorage\([\s\S]*return true;[\s\S]*saveMvSubmissionAction\(/,
  );
});
