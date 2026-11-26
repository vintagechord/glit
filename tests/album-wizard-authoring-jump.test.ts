import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// On the file and final-check steps (5–6) only uploadDrafts holds each
// album's uploaded files and email choice; albumDrafts still has the copies
// made before the file step. The track and basic-info steps rebuild the
// album list from albumDrafts, so every jump from there back to steps 1–4
// has to put the list back together first, or the additional albums lose
// their uploads (and a later 임시 저장 deletes them on the server).
const wizard = readFileSync(
  new URL("../src/features/submissions/album-wizard.tsx", import.meta.url),
  "utf8",
);

const sliceBetween = (start: string, end: string) => {
  const from = wizard.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = wizard.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return wizard.slice(from, to);
};

test("leaving the file step restores album 1 to the form and the other albums with their uploads", () => {
  const restore = sliceBetween(
    "const restoreAuthoringDrafts = () => {",
    "const returnFromUploadStep",
  );
  assert.match(restore, /if \(!uploadDrafts \|\| uploadDrafts\.length === 0\) return true;/);
  assert.match(
    restore,
    /uploadDraftIndex !== 0 &&\s*uploads\.some\(\(upload\) => upload\.status !== "done"\)[\s\S]*?return false;/,
    "an additional album whose upload is still running must not be left behind",
  );
  assert.match(restore, /const drafts = resolveUploadDrafts\(\);/);
  assert.match(restore, /setAlbumDrafts\(drafts\.slice\(1\)\);/);
  assert.match(restore, /setUploadDrafts\(null\);/);
  assert.match(restore, /setUploadDraftIndex\(0\);/);
  assert.match(restore, /applyDraftToForm\(drafts\[0\]/);
  assert.match(restore, /return true;\s*\};\s*$/);

  const back = sliceBetween("const returnFromUploadStep", "const handleStep3Next");
  assert.match(
    back,
    /if \(!restoreAuthoringDrafts\(\)\) return;\s*setStep\(hasTrackStep \? 4 : 3\);/,
  );
});

test("final-check 수정 buttons restore the album list before opening steps 1–4", () => {
  const navigate = sliceBetween(
    "const handlePreflightNavigate",
    "const albumCheckpointSnapshot",
  );
  assert.match(navigate, /if \(nextStep < 5 && !restoreAuthoringDrafts\(\)\) return;/);
  const restoreAt = navigate.indexOf("restoreAuthoringDrafts()");
  assert.ok(
    restoreAt < navigate.indexOf("setActiveTrackIndex(target.trackIndex)"),
    "restoring the form resets the active track, so it has to run first",
  );
  assert.ok(restoreAt < navigate.indexOf("setStep(nextStep)"));
  // A callback memoized on these deps would keep the uploadDrafts of the
  // render that created it (null) and skip the restore.
  assert.doesNotMatch(navigate, /\[initialArchiveEntry, skipNextStepScroll\]/);
});

test("the one-click URL edit restores the album list first, and lyrics profanity never stops a step", () => {
  // Owner decision 2026-11-26: the profanity check only informs.
  assert.doesNotMatch(wizard, /validateLyricsProfanity/);
  assert.match(
    wizard,
    /onClick=\{\(\) => \{\s*if \(restoreAuthoringDrafts\(\)\) setStep\(3\);\s*\}\}[^>]*>\s*URL·접수자 정보 수정/,
  );
  assert.doesNotMatch(wizard, /onClick=\{\(\) => setStep\(3\)\}[^>]*>\s*URL·접수자 정보 수정/);
});
