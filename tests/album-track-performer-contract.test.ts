import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SUBMISSION_ADMIN_DETAIL_SELECT,
  SUBMISSION_USER_DETAIL_SELECT,
} from "../src/lib/submissions/select-columns";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("draft and detail reads round-trip one performer per album track", () => {
  const draftsRoute = read("src/app/api/submissions/drafts/route.ts");
  const guestDetail = read("src/app/track/[token]/page.tsx");
  const memberDetail = read("src/features/submissions/submission-detail-client.tsx");
  const adminDetail = read("src/app/admin/submissions/detail/page.tsx");

  assert.match(draftsRoute, /const selectTrackColumns = \[[\s\S]*"performer"/);
  assert.match(draftsRoute, /let trackSelectClause = selectTrackColumns/);
  assert.match(draftsRoute, /dropColumnFromSelect\(trackSelectClause, missing\)/);

  for (const select of [
    SUBMISSION_USER_DETAIL_SELECT,
    SUBMISSION_ADMIN_DETAIL_SELECT,
  ]) {
    assert.equal((select.match(/album_tracks \(/g) ?? []).length, 1);
    assert.match(select, /album_tracks \([^)]*performer/);
  }

  assert.match(guestDetail, /album_tracks \([^)]*performer/);
  assert.match(memberDetail, /performer\?: string \| null/);
  assert.match(memberDetail, /track\.performer \|\| submission\.artist_name/);
  assert.match(adminDetail, /performer\?: string \| null/);
  assert.match(adminDetail, /track\.performer \|\| submission\.artist_name/);
});

test("admin-created tracks safely fall back to the submission artist", () => {
  const action = read("src/features/admin/actions.ts");
  const adminDetail = read("src/app/admin/submissions/detail/page.tsx");
  const createStart = action.indexOf("const createTrackSchema");
  const deleteStart = action.indexOf("const deleteTrackSchema", createStart);
  const handlerStart = action.indexOf(
    "export async function createTrackForSubmissionAction",
    deleteStart,
  );
  const handlerEnd = action.indexOf(
    "export async function deleteTrackForSubmissionAction",
    handlerStart,
  );
  const schema = action.slice(createStart, deleteStart);
  const handler = action.slice(handlerStart, handlerEnd);

  assert.match(schema, /performer: z\.string\(\)\.max\(2_000\)\.optional\(\)/);
  assert.match(handler, /performer: formData\.get\("performer"\)/);
  assert.match(handler, /\.from\("submissions"\)[\s\S]*\.select\("artist_name"\)/);
  assert.match(handler, /performer = submission\?\.artist_name\?\.trim\(\) \?\? ""/);
  assert.match(handler, /performer: performer \|\| null/);
  assert.match(adminDetail, /name="performer"/);
  assert.match(adminDetail, /defaultValue=\{submission\.artist_name \|\| ""\}/);
});

test("review documents use the stored performer with an album-artist fallback", () => {
  const reviewDocs = read("src/lib/admin/review-docs.ts");

  assert.match(
    reviewDocs,
    /performer: getText\(track, "performer"\) \|\| artistNameRaw/,
  );
  assert.match(
    reviewDocs,
    /performer: getText\(track, "performer"\) \|\| getText\(track, "performers"\)/,
  );
});
