import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const getExportedFunctionBody = (source: string, functionName: string) => {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const nextExport = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, nextExport === -1 ? source.length : nextExport);
};

test("admin proxy never trusts unsigned role-check cookies", () => {
  const source = read("../src/proxy.ts");
  assert.doesNotMatch(source, /glit_(?:auth|admin).*checked/);
  assert.doesNotMatch(source, /isAdminRoute\s*&&\s*isAuthCheckFresh/);
  assert.doesNotMatch(source, /isAdminRoute\s*&&\s*isAdminRoleCheckFresh/);

  const layout = read("../src/app/admin/layout.tsx");
  assert.match(layout, /await requireAdminForApi\(\)/);
});

test("service-role admin actions authorize before mutation", () => {
  const source = read("../src/features/admin/actions.ts");
  const privilegedActions = [
    "updateSubmissionStatusAction",
    "updateSubmissionMvRatingAction",
    "updateSubmissionBasicInfoAction",
    "updatePaymentStatusAction",
    "updateStationReviewAction",
    "updateStationReviewFormAction",
    "createTrackForSubmissionAction",
    "deleteTrackForSubmissionAction",
    "updateSubmissionResultAction",
    "updateArtistAction",
    "deleteSubmissionsAction",
    "deleteArtistAction",
    "deleteArtistsAction",
    "saveSubmissionAdminFormAction",
  ];

  for (const action of privilegedActions) {
    assert.match(
      getExportedFunctionBody(source, action),
      /await requireAdminAction\(\)/,
      `${action} must authorize independently`,
    );
  }

  const karaokeSource = read("../src/features/karaoke/actions.ts");
  for (const action of [
    "updateKaraokePromotionRecommendationStatusAction",
    "updateKaraokeVoteStatusAction",
    "updateKaraokeStatusAction",
  ]) {
    assert.match(
      getExportedFunctionBody(karaokeSource, action),
      /await requireAdminAction\(\)/,
      `${action} must authorize independently`,
    );
  }
});

test("service-role admin pages authorize before loading privileged data", () => {
  const pages = new Map([
    ["../src/app/admin/page.tsx", "getDashboardSummary()"],
    ["../src/app/admin/credits/page.tsx", "createAdminClient()"],
    ["../src/app/admin/credits/requests/page.tsx", "createAdminClient()"],
    ["../src/app/admin/users/page.tsx", "createAdminClient()"],
    ["../src/app/admin/artists/page.tsx", "createAdminClient()"],
    ["../src/app/admin/artists/[id]/page.tsx", "createAdminClient()"],
    ["../src/app/admin/payments/page.tsx", "createAdminClient()"],
    ["../src/app/admin/submissions/detail/page.tsx", "createAdminClient()"],
  ]);
  for (const [path, privilegedLoad] of pages) {
    const source = read(path);
    const pageBody = source.slice(source.indexOf("export default async function"));
    const authorization = pageBody.indexOf("await requireAdminPage()");
    const privilegedClient = pageBody.indexOf(privilegedLoad, authorization);
    assert.ok(authorization >= 0, `${path} must authorize independently`);
    assert.ok(
      privilegedClient > authorization,
      `${path} must authorize before creating a service-role client`,
    );
  }
});

test("financial and review tables reject owner writes at the RLS boundary", () => {
  const migration = read("../supabase/migrations/0074_harden_privileged_writes.sql");

  for (const legacyPolicy of [
    "Submission payments writeable by owner or admin",
    "Subscription billing writeable by owner or admin",
    "Subscriptions writeable by owner or admin",
    "Subscription history writeable by owner or admin",
    "Karaoke requests public readable",
    "Files insertable",
    "Station reviews insertable",
    "Submission events insertable",
  ]) {
    assert.match(migration, new RegExp(`drop policy if exists \\\"${legacyPolicy}`));
  }

  assert.match(migration, /create trigger protect_submission_privileged_fields/);
  assert.match(migration, /payment_status/);
  assert.match(migration, /amount_krw/);
  assert.match(migration, /result_status/);
});
