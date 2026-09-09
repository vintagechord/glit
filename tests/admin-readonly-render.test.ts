import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// GET render paths are deliberately checked at their side-effect boundary:
// these helpers reset package mappings or insert customer review records.
// Initial station seeding belongs to migrations; edits belong to authorized actions.
test("admin GET rendering cannot initialize catalog or customer review rows", () => {
  const config = readFileSync("src/app/admin/config/page.tsx", "utf8");
  const detail = readFileSync("src/app/admin/submissions/detail/page.tsx", "utf8");
  assert.doesNotMatch(config, /syncAlbumStationCatalog/);
  assert.doesNotMatch(detail, /ensureAlbumStationReviews/);
  for (const source of [config, detail]) assert.doesNotMatch(source, /\.(?:upsert|insert|update|delete)\(/);
  assert.match(config, /await requireAdminPage\(\)/);
  assert.match(detail, /stationId=\{review\.station_id/);
});

test("configuration actions surface mutation errors to their form", () => {
  const actions = readFileSync("src/features/admin/actions.ts", "utf8");
  for (const name of ["upsertPackageFormAction", "upsertStationFormAction", "updatePackageStationsFormAction", "updateAlbumReviewDiscountFormAction", "deletePackageFormAction", "deleteStationFormAction", "upsertProfanityTermFormAction", "deleteProfanityTermFormAction"]) {
    const action = actions.split(`export async function ${name}(`)[1]?.split("\nexport async function ")[0];
    assert.ok(action, name);
    assert.match(action, /if \(result\.error\) \{\s+return result;/, name);
  }
});
