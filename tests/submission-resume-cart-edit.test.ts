import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The cart's 수정 link points the wizard locator at an unpaid cart
// application, and edits to it stay in this browser until they are saved.
// When that edit is left unsaved, the next visit offers it in the generic
// "임시저장된 신청서가 있습니다" prompt. Its 삭제 must only forget that local
// edit: deleting the application itself belongs to the cart page, which asks
// first ("접수 현황도 함께 삭제됩니다. 삭제할까요?").
const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const albumWizard = read("src/features/submissions/album-wizard.tsx");
const mvWizard = read("src/features/submissions/mv-wizard.tsx");

const sliceBetween = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
};

test("album resume 삭제 keeps cart applications and forgets only the local edit", () => {
  const cancel = sliceBetween(
    albumWizard,
    "const handleResumeDraftCancel",
    "React.useEffect(",
  );
  assert.doesNotMatch(cancel, /clearCartSubmissions/);
  // Plain drafts are still deleted; a set that holds a cart row deletes
  // nothing on the server (its drafts belong to that cart edit).
  assert.match(
    cancel,
    /if \(cartIds\.length === 0 && draftIds\.length > 0\) \{\s*await clearServerDrafts\(\{/,
  );
  assert.match(cancel, /clearDraftStorageForSubmissions\(ids\);/);
  // The locator can list ids the server no longer returns; forget it by the
  // exact ids the prompt was built from, or the prompt comes back every visit.
  assert.match(
    cancel,
    /clearDraftStorageForSubmissions\(resumePrompt\.storedSubmissionIds\)/,
  );

  // Removing an additional cart album from the album list still asks first.
  const removeAlbum = sliceBetween(
    albumWizard,
    "const removeAlbumDraft",
    "const handleBasicInfoNext",
  );
  assert.match(removeAlbum, /showCenteredConfirm\([\s\S]*clearCartSubmissions\(/);
});

test("MV resume 삭제 keeps a cart application and forgets only the local edit", () => {
  const cancel = sliceBetween(
    mvWizard,
    "const handleResumeDraftCancel",
    "React.useEffect(",
  );
  assert.doesNotMatch(cancel, /clearCartSubmission/);
  assert.match(
    cancel,
    /if \(status === "DRAFT" \|\| status === "PRE_REVIEW"\) \{\s*await clearServerDrafts\(\{ ids: \[draftId\], guestToken \}\);\s*\} else if \(status !== "SUBMITTED" && status !== "WAITING_PAYMENT"\) \{\s*throw new Error/,
  );
  assert.match(cancel, /clearDraftStorageForSubmission\(draftId\);/);
  assert.doesNotMatch(mvWizard, /fetchWithTimeout\("\/api\/cart\/items"/);
});
