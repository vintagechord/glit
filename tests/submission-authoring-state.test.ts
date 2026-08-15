import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("authoring choices and draft bundle identity are durable and protected", () => {
  const migration = read(
    "supabase/migrations/0090_submission_authoring_state.sql",
  );
  const atomicSave = read(
    "supabase/migrations/0089_atomic_submission_parent_save.sql",
  );

  for (const column of [
    "application_form_mode",
    "files_submitted_by_email",
    "mv_selected_station_codes",
    "album_draft_group_id",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
    assert.match(atomicSave, new RegExp(`'${column}'`));
  }
  assert.match(migration, /protect_submission_authoring_state/);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) = 'service_role'/);
  assert.match(migration, /on delete set null/);

  // Only rows with an actual submitted form file are backfilled as upload.
  // Ambiguous unfinished drafts stay NULL and ask the user to choose again.
  assert.match(
    migration,
    /set application_form_mode = 'upload'[\s\S]*original_name[\s\S]*hwp\|doc\|docx/,
  );
  assert.doesNotMatch(
    migration,
    /set application_form_mode = 'online'[\s\S]*where application_form_mode is null\s*;/,
  );
});

test("draft reads round-trip authoring choices and expand only verified bundles", () => {
  const route = read("src/app/api/submissions/drafts/route.ts");

  assert.match(route, /"album_price_tier"/);
  assert.match(route, /"album_draft_group_id"/);
  assert.match(route, /"application_form_mode"/);
  assert.match(route, /"files_submitted_by_email"/);
  assert.match(route, /"mv_selected_station_codes"/);

  const tokenVerification = route.indexOf(
    "guestTokensBySubmissionId[submissionId] === row.guest_token",
  );
  const groupExpansion = route.indexOf(
    '.in("album_draft_group_id", groupIds)',
    tokenVerification,
  );
  assert.ok(tokenVerification >= 0);
  assert.ok(groupExpansion > tokenVerification);
  assert.match(route, /rpc\("delete_submission_drafts_atomic"/);
  assert.match(route, /return NextResponse\.json\(\{ ok: true, deletedIds \}\)/);
});

test("album group binding checks the exact base owner before atomic save", () => {
  const actions = read("src/features/submissions/actions.ts");

  assert.match(actions, /albumDraftGroupGuestToken/);
  assert.match(
    actions,
    /\.eq\("id", albumDraftGroupId\)[\s\S]*\.eq\("album_price_tier", "FULL"\)[\s\S]*\.eq\("payment_status", "UNPAID"\)/,
  );
  assert.match(
    actions,
    /\.eq\([\s\S]*"guest_token",[\s\S]*parsed\.data\.albumDraftGroupGuestToken/,
  );
  assert.match(actions, /album_draft_group_id: albumDraftGroupId/);
});

test("unselected form mode remains null during draft autosave", () => {
  const actions = read("src/features/submissions/actions.ts");
  const album = read("src/features/submissions/album-wizard.tsx");
  const mv = read("src/features/submissions/mv-wizard.tsx");

  assert.match(
    actions,
    /applicationFormMode: z\.enum\(\["online", "upload"\]\)\.nullable\(\)\.optional\(\)/,
  );
  assert.match(
    actions,
    /parsed\.data\.applicationFormMode === "online"[\s\S]*isSubmitted[\s\S]*\? "online"[\s\S]*: null/,
  );
  assert.match(actions, /application_form_mode: applicationFormMode/);
  assert.match(album, /applicationFormMode: sourceSnapshot\.applicationFormMode/);
  assert.match(mv, /applicationFormMode: source\.applicationFormMode/);
});
