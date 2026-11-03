import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifySubmissionDelete } from "../src/lib/submission-delete-request";
import {
  getGuestDraftSlotKey,
  getGuestDraftTokenKey,
  getParkedGuestDraftSlotsKey,
  parkGuestDraftSlot,
  readGuestDraftLeftovers,
  restoreParkedGuestDraftSlot,
  retainGuestDraftLeftovers,
  type GuestDraftStorage,
} from "../src/lib/submission-guest-drafts";
import {
  isSameSubmissionVersion,
  normalizeSubmissionVersion,
  recordSubmissionVersion,
} from "../src/lib/submission-version";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

class MemoryStorage implements GuestDraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const D = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const tokenD = "guest-token-draft-0001";
const tokenD2 = "guest-token-draft-0002";
const tokenC = "guest-token-cart-0001";

// 1. Draft creation never hands back a saved draft as if it were new ----------

test("draft creation marks a returned existing draft and only resumes unpaid drafts", () => {
  const route = read("src/app/api/submissions/draft/route.ts");
  const finder = route.slice(
    route.indexOf("async function findExistingDraft"),
    route.indexOf("export async function POST"),
  );
  assert.match(finder, /\.or\("payment_status\.is\.null,payment_status\.eq\.UNPAID"\)/);
  assert.match(finder, /\.is\("current_order_id", null\)/);
  assert.match(finder, /\.is\("user_deleted_at", null\)/);
  // Both the guest lookup and the member insert fallback say "reused".
  assert.equal(route.match(/reused: true/g)?.length, 2);
  assert.match(route, /select\("id, guest_token, updated_at"\)/);
  assert.match(route, /updatedAt: data\.updated_at \?\? null/);
});

test("both wizards load a reused draft through the resume prompt, never as a blank form", () => {
  for (const path of [
    "src/features/submissions/album-wizard.tsx",
    "src/features/submissions/mv-wizard.tsx",
  ]) {
    const source = read(path);
    const reused = source.slice(
      source.indexOf("json.reused) {"),
      source.indexOf("if (res.ok && json?.submissionId) {", source.indexOf("json.reused) {")),
    );
    assert.ok(reused.length > 0, path);
    assert.match(reused, /resumePromptHandledRef\.current = false;/, path);
    assert.match(reused, /setResumeChecked\(false\);/, path);
    assert.match(reused, /return null;/, path);
    assert.doesNotMatch(reused, /setCurrentSubmissionId|submissionIdRef\.current =/, path);
    // A second miss for the same draft shows an error instead of looping.
    assert.match(reused, /REUSED_DRAFT_LOAD_ERROR/, path);
  }
});

test("a failed guest draft lookup is an error, not an empty draft list", () => {
  const route = read("src/app/api/submissions/drafts/route.ts");
  assert.doesNotMatch(route, /if \(isGuest\) \{\s*return NextResponse\.json\(\{ ok: true, drafts: \[\] \}\);/);
});

// 2. Saves carry the version the browser last loaded or saved ---------------

test("submission versions compare Postgres microseconds and time zones exactly", () => {
  assert.equal(
    normalizeSubmissionVersion("2026-11-03T05:12:34.123456+00:00"),
    normalizeSubmissionVersion("2026-11-03 14:12:34.123456+09"),
  );
  assert.ok(
    isSameSubmissionVersion("2026-11-03T05:12:34.1+00:00", "2026-11-03T05:12:34.100000Z"),
  );
  assert.ok(
    !isSameSubmissionVersion("2026-11-03T05:12:34.123456+00:00", "2026-11-03T05:12:34.123457+00:00"),
    "a microsecond-later save is a different version",
  );
  assert.ok(!isSameSubmissionVersion("", "2026-11-03T05:12:34Z"));
  assert.ok(!isSameSubmissionVersion("not a date", "not a date"));

  const versions = new Map<string, string>();
  recordSubmissionVersion(versions, D, "2026-11-03T05:12:34.123456+00:00");
  recordSubmissionVersion(versions, D, undefined);
  recordSubmissionVersion(versions, D, "garbage");
  recordSubmissionVersion(versions, "", "2026-11-03T05:12:34Z");
  assert.deepEqual([...versions], [[D, "2026-11-03T05:12:34.123456+00:00"]]);
});

test("save actions refuse a stale version before any lease and return the new version", () => {
  const source = read("src/features/submissions/actions.ts");
  const album = source.slice(
    source.indexOf("export async function saveAlbumSubmissionAction"),
    source.indexOf("export async function saveMvSubmissionAction"),
  );
  const mv = source.slice(source.indexOf("export async function saveMvSubmissionAction"));
  assert.match(source, /expectedUpdatedAt: submissionVersionSchema,[\s\S]*expectedUpdatedAt: submissionVersionSchema,/);
  for (const [label, action] of [["album", album], ["mv", mv]] as const) {
    const check = action.indexOf("isSameSubmissionVersion(");
    const claim = action.indexOf("claimSubmissionSaveLease(");
    const commit = action.indexOf('"commit_submission_save_v2"');
    const saved = action.indexOf("const savedVersion = await readSubmissionVersion(");
    assert.ok(check > 0 && check < claim, `${label}: version check must precede the lease`);
    assert.match(action.slice(check, claim), /conflict: true/, label);
    assert.ok(saved > commit, `${label}: the new version is read after the commit`);
    assert.match(action, /updatedAt: savedVersion/, label);
    // A failed commit still touched updated_at through the lease.
    assert.match(
      action.slice(commit, saved),
      /releaseSubmissionSaveLease[\s\S]*updatedAt: await readSubmissionVersion/,
      label,
    );
  }
});

test("both wizards send and remember versions and stop autosave on a conflict", () => {
  for (const path of [
    "src/features/submissions/album-wizard.tsx",
    "src/features/submissions/mv-wizard.tsx",
  ]) {
    const source = read(path);
    const sends = source.match(/expectedUpdatedAt: submissionVersionsRef\.current\.get\(/g) ?? [];
    assert.equal(sends.length, 2, `${path}: draft and final saves send the version`);
    assert.ok(
      (source.match(/recordSubmissionVersion\(/g) ?? []).length >= 4,
      `${path}: created, resumed and saved versions are remembered`,
    );
    assert.equal(
      (source.match(/if \(result\.conflict\) \{\s*\w+CheckpointControllerRef\.current\?\.markConflict\(result\.error\);/g) ?? []).length,
      2,
      path,
    );
    assert.match(source, /conflict=\{\w+Checkpoint\.conflict\}/, path);
    assert.match(source, /onReload=\{\(\) => window\.location\.reload\(\)\}/, path);
  }
  const hook = read("src/features/submissions/use-submission-checkpoint.ts");
  assert.match(hook, /if \(blockedForConflictRef\.current\) return false;/);
  assert.match(hook, /blockedForRecoveryRef\.current \|\|\s*blockedForConflictRef\.current \|\|/);
  assert.match(hook, /if \(!result\.ok && result\.conflict\) \{\s*blockedForConflictRef\.current = true;/);
  assert.match(hook, /markConflict,/);
  // A new identity (reload or another draft) starts unblocked.
  assert.match(hook, /blockedForRecoveryRef\.current = false;\s*blockedForConflictRef\.current = false;/);
  const indicator = read("src/features/submissions/submission-save-indicator.tsx");
  assert.match(indicator, /if \(conflict\) \{[\s\S]*role="alert"[\s\S]*최신 내용 다시 불러오기/);
});

// 3. Cart edits keep the guest's draft reference ----------------------------

test("a cart edit parks the guest draft slot and the wizard restores it when free", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    getGuestDraftSlotKey("album"),
    JSON.stringify({ ids: [D, D2], guestToken: tokenD, guestTokensBySubmissionId: { [D]: tokenD, [D2]: tokenD2 } }),
  );
  assert.equal(parkGuestDraftSlot(storage, "album", { cartSubmissionIds: [C] }), true);
  // The cart edit now owns the slot.
  storage.setItem(getGuestDraftSlotKey("album"), JSON.stringify({ ids: [C], guestToken: tokenC }));
  storage.setItem(getGuestDraftTokenKey("album"), tokenC);
  // Opening another cart item does not park the first cart item.
  assert.equal(parkGuestDraftSlot(storage, "album", { cartSubmissionIds: [C] }), false);
  assert.equal(restoreParkedGuestDraftSlot(storage, "album"), false, "slot still in use");

  storage.removeItem(getGuestDraftSlotKey("album"));
  assert.equal(restoreParkedGuestDraftSlot(storage, "album"), true);
  assert.deepEqual(JSON.parse(storage.getItem(getGuestDraftSlotKey("album"))!).ids, [D, D2]);
  assert.equal(storage.getItem(getGuestDraftTokenKey("album")), tokenD);
  assert.equal(storage.getItem(getParkedGuestDraftSlotsKey("album")), null);

  const mv = new MemoryStorage();
  mv.setItem(getGuestDraftSlotKey("mv"), JSON.stringify({ id: D, guestToken: tokenD, mvType: "MV_DISTRIBUTION" }));
  assert.equal(parkGuestDraftSlot(mv, "mv", { cartSubmissionIds: [D] }), false, "the edited item itself");
  assert.equal(parkGuestDraftSlot(mv, "mv", { cartSubmissionIds: [C] }), true);
  mv.removeItem(getGuestDraftSlotKey("mv"));
  assert.equal(restoreParkedGuestDraftSlot(mv, "mv"), true);
  assert.equal(JSON.parse(mv.getItem(getGuestDraftSlotKey("mv"))!).id, D);

  const checkout = read("src/components/dashboard/submission-cart-checkout.tsx");
  const prepare = checkout.slice(
    checkout.indexOf("const prepareEditStorage"),
    checkout.indexOf("const handleDeleteItems"),
  );
  assert.ok(prepare.indexOf("parkGuestDraftSlot(") < prepare.indexOf("window.localStorage.setItem("));
  for (const path of [
    "src/features/submissions/album-wizard.tsx",
    "src/features/submissions/mv-wizard.tsx",
  ]) {
    assert.match(read(path), /if \(isGuest && !isFromDraftsTab\) \{\s*restoreParkedGuestDraftSlot\(/, path);
  }
});

// 4. Login forgets only the guest tokens that were adopted -------------------

test("login adoption presents parked tokens and keeps the ones the server did not take", () => {
  const storage = new MemoryStorage();
  storage.setItem(getGuestDraftSlotKey("album"), JSON.stringify({ ids: [D], guestToken: tokenD }));
  storage.setItem(getGuestDraftTokenKey("album"), tokenD);
  storage.setItem(
    getParkedGuestDraftSlotsKey("album"),
    JSON.stringify([{ ids: [D2], guestToken: tokenD2 }]),
  );
  const leftovers = readGuestDraftLeftovers(storage, "album");
  assert.deepEqual(leftovers?.ids, [D], "only the active slot is offered for resuming");
  assert.deepEqual(leftovers?.guestTokensBySubmissionId, { [D]: tokenD, [D2]: tokenD2 });
  assert.equal(leftovers?.guestToken, tokenD);

  // D2 was mid-save, so the claim skipped it.
  retainGuestDraftLeftovers(storage, "album", [tokenD2]);
  assert.equal(storage.getItem(getGuestDraftSlotKey("album")), null);
  assert.equal(storage.getItem(getGuestDraftTokenKey("album")), null);
  assert.deepEqual(
    JSON.parse(storage.getItem(getParkedGuestDraftSlotsKey("album"))!),
    [{ ids: [D2], guestToken: tokenD2 }],
  );
  retainGuestDraftLeftovers(storage, "album", []);
  assert.equal(readGuestDraftLeftovers(storage, "album"), null);

  const route = read("src/app/api/submissions/drafts/route.ts");
  assert.match(route, /if \(claimError\) \{\s*claimFailed = true;/);
  assert.match(route, /retainedGuestTokens = Array\.from\(/);
  assert.equal(route.match(/\.\.\.claimResult/g)?.length, 2, "both success responses report the claim");
  for (const path of [
    "src/features/submissions/album-wizard.tsx",
    "src/features/submissions/mv-wizard.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /clearGuestLeftovers/, path);
    assert.match(
      source,
      /if \(guestLeftovers && res\.ok && json && !json\.claimFailed\) \{\s*retainGuestDraftLeftovers\(/,
      path,
    );
  }
});

// 5. Members can open files from a guest tracking page ------------------------

test("a signed-in member falls back to the guest token for file downloads", () => {
  const source = read("src/features/submissions/actions.ts");
  const action = source.slice(
    source.indexOf("export async function getSubmissionFileUrlAction"),
    source.indexOf("export async function saveAlbumSubmissionAction"),
  );
  assert.match(action, /if \(user && ownedSubmission\) \{/);
  assert.doesNotMatch(action, /if \(!ownedSubmission\) \{\s*return \{ error: "접근 권한이 없습니다\." \};/);
  const guest = action.slice(action.indexOf("if (!parsed.data.guestToken)"));
  assert.match(guest, /\.eq\("guest_token", parsed\.data\.guestToken\)/);
  assert.match(guest, /if \(fileRow\.purged_at\)/);
});

// 6. History deletion only hard-deletes unpaid drafts ------------------------

test("history deletion hard-deletes only unpaid drafts and hides paid or refunded records", () => {
  const row = (status: string, payment_status: string, current_order_id: string | null = null) =>
    classifySubmissionDelete({ id: D, status, payment_status, current_order_id });
  assert.equal(row("DRAFT", "UNPAID"), "delete");
  assert.equal(row("PRE_REVIEW", "UNPAID"), "delete");
  assert.equal(row("PRE_REVIEW", "PAID"), "hide", "paid and awaiting review");
  assert.equal(row("COMPLETED", "PAID"), "hide");
  assert.equal(row("WAITING_PAYMENT", "REFUNDED"), "hide");
  assert.equal(row("WAITING_PAYMENT", "PAYMENT_PENDING"), "refuse");
  assert.equal(row("SUBMITTED", "UNPAID"), "refuse", "cart items belong to the cart");
  assert.equal(row("DRAFT", "UNPAID", C), "refuse", "ordered rows belong to the order");

  const route = read("src/app/api/submissions/delete/route.ts");
  assert.match(route, /classifySubmissionDelete\(item\) === "refuse"[\s\S]*status: 409/);
  const hardDelete = route.slice(route.indexOf(".delete()"), route.indexOf('.select("id")', route.indexOf(".delete()")));
  assert.match(hardDelete, /\.in\("status", \["DRAFT", "PRE_REVIEW"\]\)/);
  assert.match(hardDelete, /\.eq\("payment_status", "UNPAID"\)/);
  assert.match(hardDelete, /\.is\("current_order_id", null\)/);
  assert.doesNotMatch(route, /\.neq\("payment_status", "PAID"\)/);
});

// 8. The empty-draft purge keeps drafts with any saved form content ----------

test("the empty-draft purge reads every form column and keeps its grants and job", () => {
  const migration = read("supabase/migrations/20261103140000_empty_draft_purge_content.sql");
  for (const column of [
    "package_id is null",
    "coalesce(s.amount_krw,0)=0",
    "artist_id is null",
    "release_date is null",
    "s.genre",
    "s.mv_director",
    "s.mv_storyline",
    "s.mv_lyrics",
    "mv_production_date is null",
    "cardinality(s.mv_selected_station_codes)",
    "application_form_mode is null",
    "files_submitted_by_email",
  ]) {
    assert.ok(migration.includes(column), column);
  }
  assert.match(migration, /purge_empty_draft_submissions\(p_min_age interval default interval '24 hours',p_limit integer default 500\)/);
  assert.match(migration, /security invoker set search_path=public/);
  assert.match(migration, /revoke all on function public\.purge_empty_draft_submissions\(interval,integer\) from public,anon,authenticated;/);
  assert.match(migration, /grant execute on function public\.purge_empty_draft_submissions\(interval,integer\) to service_role;/);
  assert.match(migration, /cron\.schedule\('onside-purge-empty-drafts','17 \* \* \* \*','select public\.purge_empty_draft_submissions\(\)'\)/);
  assert.match(migration, /for update skip locked/);
  assert.match(read("scripts/submission-orders-sql-test.sh"), /tests\/sql\/empty-draft-purge\.sql/);
});
