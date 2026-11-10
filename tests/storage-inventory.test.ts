import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  B2_S3_ENDPOINT: "https://s3.fixture.invalid", B2_REGION: "fixture", B2_BUCKET: "bucket",
  B2_PREFIX: "submissions/", B2_KEY_ID: "id", B2_APPLICATION_KEY: "key",
});

type Row = Record<string, unknown>;
type Entry = { key: string; versionId: string; size: number; lastModified: string | null; latest: boolean; marker: boolean };

const load = () => import("../src/lib/admin/storage-inventory");

/** Enough of the query builder for the inventory's lookups. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let range: [number, number] | null = null;
    const query = {
      select() { return query; },
      order() { return query; },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query; },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
      is(column: string, value: unknown) { filters.push(row => (row[column] ?? null) === value); return query; },
      range(start: number, end: number) { range = [start, end]; return query; },
      then(resolve: (value: unknown) => void) {
        const matched = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        resolve({ data: range ? matched.slice(range[0], range[1] + 1) : matched, error: null });
      },
    };
    return query;
  };
  // Typed as the admin client the inventory takes; only these calls are used.
  return { from } as never;
}

const NOW = Date.parse("2026-11-10T09:00:00Z");
const OLD = "2026-11-05T10:00:00.000Z";
const HUG = "2970044d-29ce-4e9e-ba44-8543e9383194";
const GONE = "888bddcd-6987-4c5c-8a1e-cada40fbcaa3";
const GUEST_MV = "9a0609d2-e1e8-4831-8d81-b97ac7c1aa0d";
const DRAFT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const member = "1ce6daa3-3b19-445e-89c3-41df9405a8e7";
const guest = "guest-7da91cabcd545a49e2310bbefd350136";
const sha = (char: string) => char.repeat(64);

const keys = {
  replaced: `submissions/${member}/untitled/${HUG}/eaaede72-cdcc-48ec-b465-fdb6d5590577-_HEDA_HUG_MV_.mp4`,
  certificate: `submissions/${HUG}/certificate/7375c3dd-3b25-42cb-a53d-7160a5437747_de16f185944b44fd_HUG.pdf`,
  goneCertificate: `submissions/${GONE}/certificate/a4e51331-a943-4b47-85e0-8420b62d5c26_394d990f5311ea53_cert.pdf`,
  goneMarker: `submissions/a46a151b-83b8-4d9d-abb6-0af3f361a043/_/${GONE}/042ef02a-122c-41e0-bc20-492b7870364a-GET_SOMETHING_.mp4`,
  sentCopy: `submissions/email-attachments/${HUG}/${sha("a")}.pdf`,
  pendingCopy: `submissions/email-attachments/${HUG}/${sha("b")}.png`,
  guestVideo: `submissions/${guest}/_MUSHVENOM_/${GUEST_MV}/9e4ce421-7c90-4c10-a007-36aaf39c83fa-_final_mushvenom_2.mov`,
  draftAudio: `submissions/${member}/demo/${DRAFT}/11111111-1111-4111-8111-111111111111-demo.wav`,
  recentOrphan: `submissions/${member}/demo/${DRAFT}/22222222-2222-4222-8222-222222222222-retry.wav`,
  purgedSupplement: `submissions/supplements/${HUG}/req/rev/33333333-3333-4333-8333-333333333333/fix.wav`,
  reviewJob: `submissions/review-doc-jobs/${member}/44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555`,
  thumbnail: "submissions/artist-thumbnails/thumbnail/66666666-6666-4666-8666-666666666666-face.png",
};

function bucket(): Entry[] {
  const v = (key: string, versionId: string, size: number, latest: boolean, lastModified = OLD): Entry => ({ key, versionId, size, lastModified, latest, marker: false });
  const m = (key: string, versionId: string, latest: boolean, lastModified = OLD): Entry => ({ key, versionId, size: 0, lastModified, latest, marker: true });
  return [
    v(keys.replaced, "r-old", 539_000_000, false), m(keys.replaced, "r-hide", true),
    v(keys.certificate, "c1", 400_000, true),
    v(keys.goneCertificate, "g1", 400_000, true),
    m(keys.goneMarker, "gm", true),
    v(keys.sentCopy, "s3", 130_000, true), v(keys.sentCopy, "s2", 130_000, false), v(keys.sentCopy, "s1", 130_000, false),
    v(keys.pendingCopy, "p2", 20_000, true), v(keys.pendingCopy, "p1", 20_000, false),
    v(keys.guestVideo, "gv", 2_225_000_000, true, "2026-11-09T06:00:17.000Z"),
    v(keys.draftAudio, "da", 50_000_000, true),
    v(keys.recentOrphan, "ro", 10_000_000, true, "2026-11-10T08:00:00.000Z"),
    v(keys.purgedSupplement, "ps", 30_000_000, true),
    v(keys.reviewJob, "rj", 1_000_000, true),
    v(keys.thumbnail, "th", 50_000, true),
  ];
}

function tables(): Record<string, Row[]> {
  return {
    submissions: [
      { id: HUG, title: "HUG", status: "RESULT_READY", payment_status: "PAID" },
      { id: GUEST_MV, title: "머쉬베놈 - 내리고", status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING" },
      { id: DRAFT, title: "데모", status: "DRAFT", payment_status: "UNPAID" },
    ],
    submission_files: [
      // The HUG upload that replaced the hidden one was purged after review.
      { object_key: `submissions/${member}/untitled/${HUG}/dcf5338c-new-_HEDA_HUG_MV_.mp4`, purged_at: "2026-11-03T19:18:12Z" },
      { object_key: keys.guestVideo, purged_at: null },
      { object_key: keys.draftAudio, purged_at: null },
    ],
    submission_upload_staging: [],
    submission_supplement_files: [{ object_key: keys.purgedSupplement, purged_at: "2026-11-06T00:00:00Z" }],
    email_outbox: [
      { id: "m1", status: "accepted", attachment_refs: [{ objectKey: keys.sentCopy }, { objectKey: keys.certificate }] },
      { id: "m2", status: "retry", attachment_refs: [{ objectKey: keys.pendingCopy }, { objectKey: keys.certificate }] },
    ],
  };
}

const guestCandidate = {
  submissionId: GUEST_MV, title: "머쉬베놈 - 내리고", artistName: null, type: "MV_DISTRIBUTION", refunded: false, paymentPending: true,
  stage: "in_review" as const, finishedAt: null, totalBytes: 2_225_000_000,
  files: [{ source: "upload" as const, id: "79b555fb", objectKey: keys.guestVideo, sizeBytes: 2_225_000_000 }],
};

test("keys are attributed to the part of the service that wrote them", async () => {
  const { storedKeyNamespace } = await load();
  const at = (key: string) => storedKeyNamespace(key, "submissions/");
  assert.deepEqual(at(keys.replaced), { namespace: "upload", submissionId: HUG });
  assert.deepEqual(at(keys.guestVideo), { namespace: "upload", submissionId: GUEST_MV });
  assert.deepEqual(at(keys.certificate), { namespace: "certificate", submissionId: HUG });
  assert.deepEqual(at(keys.sentCopy), { namespace: "mail_copy", submissionId: HUG });
  assert.deepEqual(at(keys.purgedSupplement), { namespace: "supplement", submissionId: HUG });
  // Same depth as an upload, but never a customer file.
  assert.equal(at(keys.reviewJob).namespace, "other");
  assert.equal(at(keys.thumbnail).namespace, "other");
  assert.equal(at("submissions/admin-free/free-upload/77777777-7777-4777-8777-777777777777-a.pdf").namespace, "other");
  assert.equal(at(`other-prefix/${member}/t/${HUG}/a.wav`).namespace, "other");
  // A title folder named "certificate" is still a customer upload, never a certificate.
  assert.deepEqual(at(`submissions/${member}/certificate/${HUG}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-song.wav`), { namespace: "upload", submissionId: HUG });
  assert.equal(at(`submissions/${member}/t/../${HUG}/a.wav`).namespace, "other");
});

test("the inventory accounts for every stored byte and finds the leftovers the purge list cannot see", async () => {
  const { loadStorageInventory } = await load();
  const inventory = await loadStorageInventory(fakeDb(tables()), {
    candidates: [guestCandidate], now: NOW, listEntries: async () => ({ entries: bucket(), truncated: false }),
  });
  const stored = bucket().filter(entry => !entry.marker);
  assert.equal(inventory.totalBytes, stored.reduce((sum, entry) => sum + entry.size, 0));
  assert.equal(inventory.totalVersions, stored.length);
  assert.equal(inventory.hiddenMarkers, 2);
  assert.equal(inventory.groups.reduce((sum, group) => sum + group.bytes, 0), inventory.totalBytes, "every byte lands in exactly one group");
  assert.equal(inventory.groups.reduce((sum, group) => sum + group.count, 0), inventory.totalVersions);
  const group = (key: string) => inventory.groups.find(entry => entry.key === key);
  assert.deepEqual(group("purgeable"), { key: "purgeable", count: 1, bytes: 2_225_000_000 });
  assert.deepEqual(group("held"), { key: "held", count: 1, bytes: 50_000_000 });
  // Both certificates are kept, including the one whose submission was deleted.
  assert.deepEqual(group("certificate"), { key: "certificate", count: 2, bytes: 800_000 });
  assert.deepEqual(group("mail_pending"), { key: "mail_pending", count: 1, bytes: 20_000 });
  assert.deepEqual(group("recent"), { key: "recent", count: 1, bytes: 10_000_000 });
  assert.deepEqual(group("other"), { key: "other", count: 2, bytes: 1_050_000 });
  assert.deepEqual(inventory.held, [{ submissionId: DRAFT, title: "데모", reason: "작성 중인 신청", count: 1, bytes: 50_000_000 }]);

  const byKey = new Map(inventory.leftovers.map(leftover => [leftover.key, leftover]));
  const summary = (key: string) => {
    const leftover = byKey.get(key);
    return leftover && [leftover.reason, leftover.bytes, leftover.versions.map(version => version.versionId)];
  };
  assert.deepEqual(summary(keys.replaced), ["hidden_upload", 539_000_000, ["r-old", "r-hide"]]);
  assert.deepEqual(summary(keys.goneMarker), ["deleted_submission", 0, ["gm"]]);
  assert.deepEqual(summary(keys.sentCopy), ["sent_mail_copy", 390_000, ["s3", "s2", "s1"]]);
  // Still needed by a mail that can be retried: only the superseded version goes.
  assert.deepEqual(summary(keys.pendingCopy), ["old_versions", 20_000, ["p1"]]);
  assert.deepEqual(summary(keys.purgedSupplement), ["unlinked_supplement", 30_000_000, ["ps"]]);
  for (const kept of [keys.certificate, keys.goneCertificate, keys.guestVideo, keys.draftAudio, keys.recentOrphan, keys.reviewJob, keys.thumbnail]) {
    assert.ok(!byKey.has(kept), kept);
  }
  assert.equal(byKey.get(keys.replaced)?.name, "_HEDA_HUG_MV_.mp4");
  assert.equal(byKey.get(keys.replaced)?.submissionTitle, "HUG");
  assert.equal(byKey.get(keys.sentCopy)?.name, "결과 메일 첨부 사본 (PDF)");
  assert.ok(inventory.leftovers.every(leftover => /^[a-f0-9]{32}$/.test(leftover.id)));
});

test("leftovers are deleted by exact version after a fresh check, and a file needed again is skipped", async () => {
  const { loadStorageInventory, deleteStorageLeftovers } = await load();
  const db = tables();
  const listed = await loadStorageInventory(fakeDb(db), { now: NOW, listEntries: async () => ({ entries: bucket(), truncated: false }) });
  const id = (key: string) => listed.leftovers.find(leftover => leftover.key === key)!.id;

  // Between listing and deleting, the sent copy is queued again by a resend.
  db.email_outbox.push({ id: "m3", status: "pending", attachment_refs: [{ objectKey: keys.sentCopy }] });
  const removed: string[] = [];
  const results = await deleteStorageLeftovers(fakeDb(db), [id(keys.replaced), id(keys.sentCopy), id(keys.pendingCopy), id(keys.goneMarker), "f".repeat(32)], {
    now: NOW,
    listEntries: async () => ({ entries: bucket(), truncated: false }),
    deleteVersion: async (key, versionId) => {
      if (versionId === "gm") throw new Error("storage down");
      removed.push(`${key}#${versionId}`);
    },
  });
  assert.deepEqual(removed, [`${keys.replaced}#r-old`, `${keys.replaced}#r-hide`, `${keys.pendingCopy}#p1`]);
  const outcome = Object.fromEntries(results.map(result => [result.id, result]));
  assert.deepEqual(outcome[id(keys.replaced)], { id: id(keys.replaced), ok: true, deletedVersions: 2, failedVersions: 0, freedBytes: 539_000_000 });
  // Now needed by the pending mail: the copy itself is kept, its older versions become a separate leftover next time.
  assert.equal(outcome[id(keys.sentCopy)].ok, false);
  assert.match(outcome[id(keys.sentCopy)].error ?? "", /다시 필요한 파일/);
  assert.deepEqual(outcome[id(keys.pendingCopy)], { id: id(keys.pendingCopy), ok: true, deletedVersions: 1, failedVersions: 0, freedBytes: 20_000 });
  assert.equal(outcome[id(keys.goneMarker)].ok, false);
  assert.equal(outcome[id(keys.goneMarker)].failedVersions, 1);
  assert.equal(outcome["f".repeat(32)].ok, false);
});

test("uploads still in flight or known only by file path are never leftovers", async () => {
  const { loadStorageInventory } = await load();
  const db = tables();
  const now = Date.parse("2026-11-20T00:00:00Z");
  db.upload_put_grants = [{ object_key: keys.recentOrphan, status: "PENDING" }];
  db.multipart_upload_grants = [{ object_key: keys.replaced, status: "COMPLETED" }];
  db.submission_files.push({ object_key: null, file_path: keys.draftAudio.replace("demo.wav", "legacy.wav"), purged_at: null });
  const legacy = keys.draftAudio.replace("demo.wav", "legacy.wav");
  const entries = [...bucket(), { key: legacy, versionId: "lg", size: 7, lastModified: OLD, latest: true, marker: false }];
  const inventory = await loadStorageInventory(fakeDb(db), { now, listEntries: async () => ({ entries, truncated: false }) });
  const leftoverKeys = new Set(inventory.leftovers.map(leftover => leftover.key));
  assert.ok(!leftoverKeys.has(keys.recentOrphan), "a pending upload grant keeps its key");
  assert.ok(!leftoverKeys.has(legacy), "a row known by file path keeps its key");
  assert.ok(leftoverKeys.has(keys.replaced), "a finished grant is not a reference");
});

test("certificates are never offered, whatever happened to their submission", async () => {
  const { loadStorageInventory } = await load();
  const replacedCertificate = `submissions/${GONE}/certificate/b4e51331-a943-4b47-85e0-8420b62d5c26_494d990f5311ea53_old.pdf`;
  const entries = [...bucket(),
    { key: replacedCertificate, versionId: "x2", size: 9, lastModified: OLD, latest: false, marker: false },
    { key: replacedCertificate, versionId: "x1", size: 0, lastModified: OLD, latest: true, marker: true }];
  const inventory = await loadStorageInventory(fakeDb(tables()), { now: NOW, listEntries: async () => ({ entries, truncated: false }) });
  assert.ok(!inventory.leftovers.some(leftover => leftover.key.includes("/certificate/")));
});

test("a record pointing at a hidden key leaves everything in place", async () => {
  const { loadStorageInventory } = await load();
  const db = tables();
  db.submission_files.push({ object_key: keys.replaced, purged_at: null });
  const inventory = await loadStorageInventory(fakeDb(db), { now: NOW, listEntries: async () => ({ entries: bucket(), truncated: false }) });
  assert.ok(!inventory.leftovers.some(leftover => leftover.key === keys.replaced));
});
