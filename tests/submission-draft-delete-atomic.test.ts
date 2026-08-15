import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("draft deletion is one locked database transaction", () => {
  const migration = read(
    "supabase/migrations/0092_atomic_draft_bundle_delete.sql",
  );
  const route = read("src/app/api/submissions/drafts/route.ts");

  assert.match(migration, /delete_submission_drafts_atomic/);
  assert.match(migration, /order by submission\.id\s+for update/);
  assert.match(
    migration,
    /with deleted as \(\s*delete from public\.submissions[\s\S]*returning submission\.id/,
  );
  assert.match(migration, /DRAFT_DELETE_VERSION_CHANGED/);
  assert.match(migration, /'b2ObjectRefs', v_refs/);
  assert.match(route, /rpc\("delete_submission_drafts_atomic"/);
  assert.doesNotMatch(route, /\.from\("submissions"\)\s*\.delete\(\)/);
});

test("album binding and payment lock the base and reject incomplete bundles", () => {
  const migration = read(
    "supabase/migrations/0092_atomic_draft_bundle_delete.sql",
  );
  assert.match(migration, /validate_album_draft_group_binding/);
  assert.match(
    migration,
    /where base\.id = new\.album_draft_group_id\s+for update/,
  );
  assert.match(migration, /ALBUM_DRAFT_GROUP_BASE_INVALID/);
  assert.match(migration, /ALBUM_GROUP_INCOMPLETE/);
  assert.match(
    migration,
    /perform sibling\.id[\s\S]*order by sibling\.id\s+for update/,
  );
});

test("draft list removes every server-confirmed bundle member", () => {
  const source = read("src/components/dashboard/draft-submission-list.tsx");
  assert.match(source, /Array\.isArray\(payload\?\.deletedIds\)/);
  assert.match(source, /confirmedIds\.forEach\(\(id\) => deletedIds\.add\(id\)\)/);
});
