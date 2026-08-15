import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveSubmissionSaveState } from "../src/lib/submission-save-staging";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("submitted cart and direct-pay saves remain non-payable while staged", () => {
  assert.deepEqual(
    resolveSubmissionSaveState({
      requestedStatus: "SUBMITTED",
      shouldRequestPayment: false,
    }),
    {
      requiresFinalization: true,
      stagingStatus: "DRAFT",
      stagingPaymentStatus: "UNPAID",
      finalStatus: "SUBMITTED",
      finalPaymentStatus: "UNPAID",
    },
  );
  assert.deepEqual(
    resolveSubmissionSaveState({
      requestedStatus: "SUBMITTED",
      shouldRequestPayment: true,
    }),
    {
      requiresFinalization: true,
      stagingStatus: "DRAFT",
      stagingPaymentStatus: "UNPAID",
      finalStatus: "WAITING_PAYMENT",
      finalPaymentStatus: "PAYMENT_PENDING",
    },
  );
});

test("draft and pre-review saves remain unpaid", () => {
  for (const requestedStatus of ["DRAFT", "PRE_REVIEW"] as const) {
    const state = resolveSubmissionSaveState({
      requestedStatus,
      shouldRequestPayment: true,
    });
    assert.equal(state.stagingStatus, requestedStatus);
    assert.equal(state.stagingPaymentStatus, "UNPAID");
    assert.equal(state.finalPaymentStatus, "UNPAID");
  }
});

test("the DB lease serializes saves and fails closed around payment", () => {
  const migration = read("supabase/migrations/0083_submission_save_lease.sql");

  assert.match(migration, /add column if not exists save_lease_token uuid/);
  assert.match(migration, /add column if not exists save_lease_expires_at timestamptz/);
  assert.match(migration, /create or replace function public\.claim_submission_save_lease/);
  assert.match(migration, /create or replace function public\.commit_submission_save/);
  assert.match(migration, /create or replace function public\.release_submission_save_lease/);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_submission\.updated_at is distinct from p_expected_updated_at/);
  assert.match(migration, /v_submission\.user_id = p_expected_user_id/);
  assert.match(migration, /v_submission\.guest_token = p_expected_guest_token/);
  assert.match(migration, /SUBMISSION_SAVE_IN_PROGRESS/);
  assert.match(migration, /clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.equal(
    (migration.match(/payment\.status = 'REQUESTED'/g) ?? []).length,
    2,
    "claim and commit must both reject an in-flight payment",
  );
  assert.match(migration, /set status = 'DRAFT',\s+payment_status = 'UNPAID'/);
  assert.match(migration, /save_lease_expires_at <= clock_timestamp\(\)/);

  for (const signature of [
    "public.claim_submission_save_lease(\n  uuid, timestamptz, uuid, text, uuid\n)",
    "public.commit_submission_save(\n  uuid, uuid, timestamptz, boolean, jsonb, boolean, text, jsonb,",
    "public.release_submission_save_lease(uuid, uuid)",
  ]) {
    assert.ok(migration.includes(`revoke all on function ${signature}`));
  }
  assert.match(migration, /grant execute on function public\.claim_submission_save_lease[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.commit_submission_save[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.release_submission_save_lease[\s\S]*to service_role/);
});

test("tracks, files, reviews, and final state are one atomic commit", () => {
  const migration = read("supabase/migrations/0083_submission_save_lease.sql");
  const start = migration.indexOf(
    "create or replace function public.commit_submission_save",
  );
  const end = migration.indexOf(
    "create or replace function public.release_submission_save_lease",
    start,
  );
  const commit = migration.slice(start, end);

  const tracksDelete = commit.indexOf("delete from public.album_tracks");
  const tracksInsert = commit.indexOf("insert into public.album_tracks");
  const filesDelete = commit.indexOf("delete from public.submission_files");
  const filesInsert = commit.indexOf("insert into public.submission_files");
  const reviewsDelete = commit.indexOf("delete from public.station_reviews");
  const reviewsInsert = commit.indexOf("insert into public.station_reviews");
  const finalize = commit.indexOf("update public.submissions submission", filesInsert);

  assert.ok(tracksDelete >= 0 && tracksInsert > tracksDelete);
  assert.ok(filesDelete > tracksInsert && filesInsert > filesDelete);
  assert.ok(reviewsDelete > filesInsert && reviewsInsert > reviewsDelete);
  assert.ok(finalize > reviewsInsert);
  assert.match(commit, /jsonb_array_length[\s\S]*> 100/);
  assert.match(commit, /row\.file_path = row\.object_key/);
  assert.match(commit, /'b2',[\s\S]*'UPLOADED'/);
  assert.match(commit, /null\s+from jsonb_to_recordset/, "client access URLs must not be stored");
  assert.match(commit, /station\.is_active = true/);
  assert.match(commit, /save_lease_token = null,\s+save_lease_expires_at = null/);
});

test("track performers are backfilled and committed without erasing omitted tracks", () => {
  const migration = read("supabase/migrations/0087_album_track_performer.sql");
  const source = read("src/features/submissions/actions.ts");
  const albumStart = source.indexOf("export async function saveAlbumSubmissionAction");
  const mvStart = source.indexOf("export async function saveMvSubmissionAction");
  const album = source.slice(albumStart, mvStart);

  assert.match(migration, /add column if not exists performer text/);
  assert.match(migration, /set performer = submission\.artist_name/);
  assert.match(migration, /nullif\(btrim\(coalesce\(track\.performer, ''\)\), ''\) is null/);
  assert.match(migration, /create or replace function public\.commit_submission_save/);
  assert.match(migration, /insert into public\.album_tracks \([\s\S]*performer,/);
  assert.match(migration, /row\.performer/);
  assert.match(migration, /performer text/);
  assert.match(migration, /v_submission\.artist_name/);
  assert.doesNotMatch(migration, /ALBUM_TRACK_REPLACEMENT_REQUIRED/);
  assert.match(
    migration,
    /revoke all on function public\.commit_submission_save\([\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.commit_submission_save\([\s\S]*to service_role/,
  );

  assert.match(source, /performer: metadataTextSchema\.optional\(\)/);
  assert.match(album, /performer: track\.performer\?\.trim\(\) \|\| artistNameValue \|\| null/);
  assert.match(
    album,
    /const shouldReplaceTracks =[\s\S]*parsed\.data\.tracks !== undefined[\s\S]*isSubmitted && \(isOneClick \|\| usesExternalApplicationForm\)/,
  );
  assert.match(album, /p_replace_tracks: shouldReplaceTracks/);
});

test("album and MV actions validate, claim, stage, and atomically commit in order", () => {
  const source = read("src/features/submissions/actions.ts");
  const albumStart = source.indexOf("export async function saveAlbumSubmissionAction");
  const mvStart = source.indexOf("export async function saveMvSubmissionAction");
  const album = source.slice(albumStart, mvStart);
  const mv = source.slice(mvStart);

  const assertOrder = (
    action: string,
    label: string,
    validator: string,
    fileKind: "AUDIO" | "VIDEO",
  ) => {
    const validation = action.indexOf(validator);
    const ownership = action.indexOf("validateSubmissionFileObjectKeys(");
    const claim = action.indexOf("claimSubmissionSaveLease(");
    const stage = action.indexOf("stageSubmissionWithColumnFallback(", claim);
    const snapshot = action.indexOf("loadSubmissionB2ObjectRefs(", stage);
    const commit = action.indexOf('"commit_submission_save"', snapshot);
    const cleanup = action.indexOf("scheduleReplacedSubmissionFileCleanup(", commit);

    assert.ok(validation >= 0, `${label}: missing submitted-field validation`);
    assert.ok(ownership >= 0 && ownership < claim, `${label}: file ownership must precede lease`);
    assert.ok(validation < claim, `${label}: required fields must precede lease`);
    assert.ok(claim >= 0 && stage > claim, `${label}: parent must be lease-staged`);
    assert.ok(snapshot > stage, `${label}: old file references must be captured after staging`);
    assert.ok(commit > snapshot, `${label}: dependent data must use the atomic RPC`);
    assert.ok(cleanup > commit, `${label}: B2 cleanup must follow a successful commit`);
    assert.match(action.slice(commit, cleanup), new RegExp(`p_file_kind: "${fileKind}"`));
    assert.match(action.slice(commit, cleanup), /p_expected_updated_at:/);
    assert.match(action.slice(commit, cleanup), /p_lease_token:/);
    assert.match(action, /releaseSubmissionSaveLease\(\{/);
    assert.doesNotMatch(action.slice(claim, cleanup), /\.from\("album_tracks"\)/);
    assert.doesNotMatch(action.slice(claim, cleanup), /\.from\("submission_files"\)/);
    assert.doesNotMatch(action.slice(claim, cleanup), /\.from\("station_reviews"\)/);
  };

  assertOrder(album, "album", "validateAlbumSubmittedFields(", "AUDIO");
  assertOrder(mv, "MV", "validateMvSubmittedFields(", "VIDEO");
});

test("service-role file metadata accepts only exact owned B2 keys and ignores client URLs", () => {
  const source = read("src/features/submissions/actions.ts");
  const helperStart = source.indexOf("const validateSubmissionFileObjectKeys");
  const helperEnd = source.indexOf(
    "const cancelStaleRequestedSubmissionPayments",
    helperStart,
  );
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /const \{ prefix \} = getB2Config\(\)/);
  assert.match(helper, /isSubmissionObjectKeyOwned\(\{/);
  assert.match(helper, /objectKey: file\.path/);
  assert.match(helper, /submissionId,/);
  assert.match(helper, /submissionUserId: userId/);
  assert.match(helper, /guestToken,/);
  assert.match(helper, /allowClaimedGuestOwner,/);

  assert.doesNotMatch(source, /access_url: file\.accessUrl/);
  assert.doesNotMatch(source, /insertWithColumnFallback/);
  assert.doesNotMatch(source, /ensureStationReviews/);
});

test("lease and privileged-field triggers do not trust a missing JWT", () => {
  for (const path of [
    "supabase/migrations/0072_protect_profile_roles.sql",
    "supabase/migrations/0074_harden_privileged_writes.sql",
    "supabase/migrations/0083_submission_save_lease.sql",
  ]) {
    const migration = read(path);
    assert.doesNotMatch(migration, /auth\.uid\(\) is null[^\n]*return new/);
  }
});

test("post-commit recipient emails run concurrently and failures stay audit-only", () => {
  const source = read("src/features/submissions/actions.ts");
  const helperStart = source.indexOf("const deliverSubmissionEmails");
  const helperEnd = source.indexOf("const loadMemberPhone", helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /Promise\.allSettled\(jobs\.map\(\(job\) => job\.send\(\)\)\)/);
  assert.match(helper, /await Promise\.allSettled\(issueWrites\)/);
  assert.doesNotMatch(helper, /throw\s+/);
  assert.equal(
    (source.match(/await deliverSubmissionEmails\(\{/g) ?? []).length,
    2,
    "album and MV saves must share the concurrent non-fatal delivery path",
  );
  assert.equal(
    (source.match(/const kakaoDelivery = \(async \(\) => \{/g) ?? []).length,
    2,
  );
  assert.equal(
    (source.match(/\}\)\(\)\.catch\(\(error\) => \{/g) ?? []).length,
    2,
    "unexpected Kakao errors must remain post-commit and non-fatal",
  );
});
