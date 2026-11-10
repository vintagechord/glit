import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

type Row = Record<string, unknown>;
type PurgeApi = {
  reviewFinishedAt: (submission: Row, reviews: Row[], requests: Row[]) => string | null;
  selectPurgeFiles: (submissionId: string, uploads: Row[], supplements: Row[], prefix: string) => Array<{ source: string; id: string; objectKey: string }>;
  purgeCustomerFiles: (db: unknown, ids: string[], actor: string, remove: (key: string) => Promise<number>, scope?: "finished" | "received") => Promise<Array<{ submissionId: string; ok: boolean; deletedFiles: number; failedFiles: number; freedBytes: number; error?: string }>>;
  loadPurgeCandidates: (db: unknown, ids?: string[], scope?: "finished" | "received") => Promise<Array<{ submissionId: string; stage: string; files: Array<{ id: string; source: string }> }>>;
  resumeInterruptedPurges: (db: unknown, options: { now?: number; limit?: number; deleteAllVersions?: (key: string) => Promise<number> }) => Promise<number>;
  presignGetUrl: (key: string, expiresIn?: number, options?: { filename?: string }) => Promise<string>;
  attachmentContentDisposition: (filename: string) => string;
  deleteObjectAllVersions: (key: string) => Promise<number>;
  s3: { pages: Array<{ Versions?: Row[]; DeleteMarkers?: Row[]; IsTruncated?: boolean; NextKeyMarker?: string; NextVersionIdMarker?: string }>; sent: Array<{ command: string; input: Row }>; signed: Array<{ input: Row; options: Row }> };
};

async function load(): Promise<PurgeApi> {
  Object.assign(process.env, {
    B2_S3_ENDPOINT: "https://s3.fixture.invalid", B2_REGION: "fixture", B2_BUCKET: "bucket",
    B2_PREFIX: "submissions/", B2_KEY_ID: "id", B2_APPLICATION_KEY: "key",
  });
  const bundle = await build({
    stdin: {
      contents: "export * from './src/lib/admin/customer-file-purge'; export { deleteObjectAllVersions, presignGetUrl, attachmentContentDisposition } from './src/lib/b2'; export { s3 } from 's3-fixture';",
      resolveDir: process.cwd(), loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "s3-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(s3-fixture|@aws-sdk\/client-s3|@aws-sdk\/s3-request-presigner)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        if (path === "s3-fixture") return { loader: "js", contents: "export const s3={pages:[],sent:[],signed:[]};" };
        if (path === "@aws-sdk/s3-request-presigner") return { loader: "js", contents: "import {s3} from 's3-fixture';export const getSignedUrl=async(client,command,options)=>{s3.signed.push({input:command.input,options});return 'https://signed.invalid'};" };
        const names = ["CreateMultipartUploadCommand", "UploadPartCommand", "CompleteMultipartUploadCommand", "AbortMultipartUploadCommand", "GetObjectCommand", "HeadObjectCommand", "PutObjectCommand", "DeleteObjectCommand", "ListObjectVersionsCommand", "ListPartsCommand", "CopyObjectCommand"];
        return { loader: "js", contents: `import {s3} from 's3-fixture';
          ${names.map(name => `export class ${name}{constructor(input){this.input=input;this.name='${name}'}}`).join("\n")}
          export class S3Client{async send(command){s3.sent.push({command:command.name,input:command.input});if(command.name==='ListObjectVersionsCommand')return s3.pages.shift()??{};return{}}}` };
      });
    } }],
  });
  const output = { exports: {} as PurgeApi };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const owner = "11111111-1111-4111-8111-111111111111";
const upload = (submissionId: string, name: string) => `submissions/${owner}/album/${submissionId}/${name}`;
const finishedAlbum = (id: string, overrides: Row = {}): Row => ({
  id, title: `album ${id.slice(0, 1)}`, artist_name: "artist", type: "ALBUM", status: "RESULT_READY", payment_status: "PAID",
  result_status: null, result_notified_at: null, mv_desired_rating: null, updated_at: "2026-10-01T00:00:00Z", ...overrides,
});

test("files qualify once a paid review is fully decided without open supplements, or once the order is refunded", async () => {
  const { reviewFinishedAt } = await load();
  const decided = [
    { submission_id: A, status: "APPROVED", updated_at: "2026-10-05T00:00:00Z" },
    { submission_id: A, status: "REJECTED", updated_at: "2026-10-07T00:00:00Z" },
  ];
  assert.equal(reviewFinishedAt(finishedAlbum(A), decided, []), "2026-10-07T00:00:00Z");
  assert.equal(reviewFinishedAt(finishedAlbum(A, { result_notified_at: "2026-10-09T00:00:00Z" }), decided, [{ status: "ACCEPTED" }]), "2026-10-09T00:00:00Z");
  assert.equal(reviewFinishedAt(finishedAlbum(A), [], []), "2026-10-01T00:00:00Z");

  for (const unpaid of ["UNPAID", "PAYMENT_PENDING"]) {
    assert.equal(reviewFinishedAt(finishedAlbum(A, { payment_status: unpaid }), decided, []), null, unpaid);
  }
  // A refund stops the review, so pending results or open supplements no longer matter.
  const refunded = finishedAlbum(A, { payment_status: "REFUNDED", status: "IN_PROGRESS", updated_at: "2026-10-20T00:00:00Z" });
  assert.equal(reviewFinishedAt(refunded, [{ submission_id: A, status: "SENT", updated_at: null }], [{ status: "OPEN" }]), "2026-10-20T00:00:00Z");
  assert.equal(reviewFinishedAt(finishedAlbum(A, { status: "IN_PROGRESS" }), decided, []), null);
  for (const pending of ["NOT_SENT", "SENT", "RECEIVED", "NEEDS_FIX"]) {
    assert.equal(reviewFinishedAt(finishedAlbum(A), [...decided, { submission_id: A, status: pending, updated_at: null }], []), null, pending);
  }
  for (const open of ["OPEN", "SUBMITTED"]) {
    assert.equal(reviewFinishedAt(finishedAlbum(A), decided, [{ status: open }]), null, open);
  }

  const onlineMv = finishedAlbum(A, { type: "MV_DISTRIBUTION", status: "IN_PROGRESS", result_status: "APPROVED", mv_desired_rating: "15" });
  // An online MV order can include Mnet/ETN reviews of the same video: a
  // published rating alone does not release the file while one is open.
  for (const pending of ["NOT_SENT", "SENT", "RECEIVED", "NEEDS_FIX"]) {
    assert.equal(reviewFinishedAt(onlineMv, [{ submission_id: A, status: pending, updated_at: null }], []), null, pending);
  }
  assert.equal(
    reviewFinishedAt(onlineMv, [{ submission_id: A, status: "APPROVED", updated_at: "2026-10-03T00:00:00Z" }, { submission_id: A, status: "SENT", updated_at: null }], []),
    null,
  );
  assert.equal(
    reviewFinishedAt(onlineMv, [{ submission_id: A, status: "APPROVED", updated_at: "2026-10-03T00:00:00Z" }, { submission_id: A, status: "REJECTED", updated_at: "2026-10-04T00:00:00Z" }], []),
    "2026-10-04T00:00:00Z",
  );
  assert.ok(reviewFinishedAt(onlineMv, [], []), "an online MV without station reviews needs only its rating");
  assert.ok(reviewFinishedAt({ ...onlineMv, mv_desired_rating: "REJECT", result_status: "REJECTED" }, [], []));
  assert.equal(reviewFinishedAt({ ...onlineMv, mv_desired_rating: "15세 희망" }, [], []), null);
  assert.equal(reviewFinishedAt({ ...onlineMv, result_status: null }, [], []), null);
});

test("only customer uploads in the customer namespaces are selected", async () => {
  const { selectPurgeFiles } = await load();
  const uploads = [
    { id: "audio", submission_id: A, kind: "AUDIO", storage_provider: "b2", object_key: upload(A, "song.wav"), size: 10, purged_at: null },
    { id: "lyrics", submission_id: A, kind: "LYRICS", storage_provider: "b2", object_key: upload(A, "lyrics.docx"), size: 2, purged_at: null },
    { id: "purged", submission_id: A, kind: "AUDIO", storage_provider: "b2", object_key: upload(A, "old.wav"), size: 1, purged_at: "2026-10-10T00:00:00Z" },
    { id: "result", submission_id: A, kind: "MV_RESULT_FILE", storage_provider: "b2", object_key: upload(A, "result.pdf"), size: 1, purged_at: null },
    { id: "certificate", submission_id: A, kind: "ETC", storage_provider: "b2", object_key: `submissions/${A}/certificate/cert.pdf`, size: 1, purged_at: null },
    { id: "mail-copy", submission_id: A, kind: "ETC", storage_provider: "b2", object_key: `submissions/email-attachments/${A}/hash.png`, size: 1, purged_at: null },
    { id: "foreign", submission_id: A, kind: "AUDIO", storage_provider: "b2", object_key: upload(B, "song.wav"), size: 1, purged_at: null },
    { id: "legacy", submission_id: A, kind: "AUDIO", storage_provider: "supabase", object_key: upload(A, "x.wav"), size: 1, purged_at: null },
    { id: "other", submission_id: B, kind: "AUDIO", storage_provider: "b2", object_key: upload(B, "song.wav"), size: 1, purged_at: null },
  ];
  const supplements = [
    { id: "supp", object_key: `submissions/supplements/${A}/r/v/u/fix.wav`, size_bytes: 5, purged_at: null },
    { id: "supp-other", object_key: `submissions/supplements/${B}/r/v/u/fix.wav`, size_bytes: 5, purged_at: null },
    { id: "supp-escape", object_key: `submissions/supplements/${A}/../${B}/fix.wav`, size_bytes: 5, purged_at: null },
    { id: "supp-done", object_key: `submissions/supplements/${A}/r/v/u/done.wav`, size_bytes: 5, purged_at: "2026-10-10T00:00:00Z" },
  ];
  assert.deepEqual(selectPurgeFiles(A, uploads, supplements, "submissions/").map(file => file.id), ["audio", "lyrics", "supp"]);
});

function fakeDb(tables: Record<string, Row[]>, failUpdate = new Set<string>()) {
  const log: string[] = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let payload: Row = {};
    let range: [number, number] | null = null;
    const query = {
      select() { return query; },
      or() { return query; },
      order() { return query; },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
      neq(column: string, value: unknown) { filters.push(row => row[column] !== value); return query; },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query; },
      is(column: string, value: unknown) { filters.push(row => (row[column] ?? null) === value); return query; },
      lt(column: string, value: unknown) { filters.push(row => row[column] != null && String(row[column]) < String(value)); return query; },
      limit() { return query; },
      range(start: number, end: number) { range = [start, end]; return query; },
      update(values: Row) { mode = "update"; payload = values; return query; },
      insert(values: Row) { mode = "insert"; payload = values; return query; },
      then(resolve: (value: unknown) => void) {
        const rows = tables[table] ?? [];
        if (mode === "insert") { rows.push(payload); log.push(`insert:${table}`); return resolve({ data: null, error: null }); }
        const matched = rows.filter(row => filters.every(filter => filter(row)));
        if (mode === "update") {
          if (failUpdate.has(table)) return resolve({ data: null, error: { message: "fixture failure" } });
          for (const row of matched) Object.assign(row, payload);
          log.push(`update:${table}:${matched.map(row => row.id).join(",")}=${payload.purged_at ? "set" : "null"}`);
          return resolve({ data: null, error: null });
        }
        const page = range ? matched.slice(range[0], range[1] + 1) : matched;
        if (table === "submission_supplement_requests") {
          return resolve({ data: page.map(request => ({ ...request, revisions: [{ files: tables.submission_supplement_files.filter(file => file.request_id === request.id) }] })), error: null });
        }
        return resolve({ data: page, error: null });
      },
    };
    return query;
  };
  return { db: { from }, log };
}

const purgeFixture = () => ({
  submissions: [finishedAlbum(A), finishedAlbum(B, { status: "IN_PROGRESS" }), finishedAlbum(C, { status: "IN_PROGRESS" }), finishedAlbum(D, { type: "MV_BROADCAST", status: "IN_PROGRESS", payment_status: "REFUNDED" })],
  station_reviews: [{ id: "r1", submission_id: A, status: "APPROVED", updated_at: "2026-10-05T00:00:00Z" }],
  submission_files: [
    { id: "a1", submission_id: A, kind: "AUDIO", storage_provider: "b2", object_key: upload(A, "song.wav"), size: 100, purged_at: null },
    { id: "a2", submission_id: A, kind: "LYRICS", storage_provider: "b2", object_key: upload(A, "lyrics.docx"), size: 20, purged_at: null },
    { id: "a3", submission_id: A, kind: "VIDEO", storage_provider: "b2", object_key: upload(A, "shared.mp4"), size: 50, purged_at: null },
    { id: "c1", submission_id: C, kind: "VIDEO", storage_provider: "b2", object_key: upload(A, "shared.mp4"), size: 50, purged_at: null },
    { id: "b1", submission_id: B, kind: "AUDIO", storage_provider: "b2", object_key: upload(B, "song.wav"), size: 100, purged_at: null },
    { id: "d1", submission_id: D, kind: "VIDEO", storage_provider: "b2", object_key: upload(D, "mv.mp4"), size: 400, purged_at: null },
  ],
  submission_upload_staging: [] as Row[],
  submission_supplement_requests: [{ id: "req", submission_id: A, status: "ACCEPTED" }],
  submission_supplement_files: [{ id: "s1", request_id: "req", object_key: `submissions/supplements/${A}/req/rev/u/fix.wav`, size_bytes: 30, purged_at: null }],
  submission_events: [] as Row[],
});

test("purging marks rows first, deletes every version, keeps shared keys, and unmarks files whose delete failed", async () => {
  const { purgeCustomerFiles } = await load();
  const tables = purgeFixture();
  const { db } = fakeDb(tables);
  const attempted: string[] = [];
  const results = await purgeCustomerFiles(db, [A, B, D], "admin-user", async key => {
    attempted.push(key);
    const rows = [...tables.submission_files, ...tables.submission_supplement_files].filter(row => row.object_key === key && row.id !== "c1");
    assert.ok(rows.every(row => row.purged_at), "rows are marked before the object is deleted");
    if (key.endsWith("lyrics.docx")) throw new Error("storage down");
    return 2;
  });

  assert.deepEqual(attempted.sort(), [upload(A, "lyrics.docx"), upload(A, "song.wav"), `submissions/supplements/${A}/req/rev/u/fix.wav`, upload(D, "mv.mp4")].sort());
  const file = (id: string) => [...tables.submission_files, ...tables.submission_supplement_files].find(row => row.id === id)!;
  assert.ok(file("a1").purged_at);
  assert.ok(file("s1").purged_at);
  assert.equal(file("a2").purged_at, null, "a failed delete stays downloadable and retryable");
  assert.equal(file("a3").purged_at, null, "an object another live row uses is kept");
  assert.equal(file("b1").purged_at, null);

  const [resultA, resultB, resultD] = results;
  assert.deepEqual({ ...resultA, error: undefined }, { submissionId: A, ok: false, deletedFiles: 2, failedFiles: 1, freedBytes: 130, error: undefined });
  assert.equal(resultB.ok, false);
  assert.match(resultB.error ?? "", /심의가 끝나지 않았거나/);
  assert.deepEqual({ ...resultD, error: undefined }, { submissionId: D, ok: true, deletedFiles: 1, failedFiles: 0, freedBytes: 400, error: undefined });
  assert.ok(file("d1").purged_at, "a refunded submission is purged even though its review stopped midway");
  const confirmedAt = (id: string) => (file(id) as Row).purge_confirmed_at ?? null;
  assert.ok(confirmedAt("a1"), "a finished delete is confirmed");
  assert.ok(confirmedAt("s1"));
  assert.equal(confirmedAt("a2"), null, "a failed delete is not confirmed");
  assert.equal(tables.submission_events.length, 2);
  assert.ok(tables.submission_events.every(event => event.event_type === "CUSTOMER_FILES_PURGED" && event.actor_user_id === "admin-user"));
  assert.match(String(tables.submission_events[0].message), /^심의 완료 후 .*2개/);
  assert.match(String(tables.submission_events[1].message), /^환불 후 .*1개/);
});

test("nothing is deleted when the rows cannot be marked, and partial marks are undone", async () => {
  const { purgeCustomerFiles } = await load();
  const tables = purgeFixture();
  const { db } = fakeDb(tables, new Set(["submission_supplement_files"]));
  const attempted: string[] = [];
  const [result] = await purgeCustomerFiles(db, [A], "admin-user", async key => { attempted.push(key); return 1; });
  assert.deepEqual(attempted, []);
  assert.equal(result.ok, false);
  assert.ok(tables.submission_files.every(row => row.purged_at === null));
  assert.equal(tables.submission_events.length, 0);
});

test("a purge cut off after marking rows is finished later, never forgotten", async () => {
  const { resumeInterruptedPurges } = await load();
  const now = Date.parse("2026-11-03T12:00:00Z");
  const stale = "2026-11-03T11:00:00Z";
  const marked = (id: string, key: string, overrides: Row = {}): Row => ({
    id, submission_id: A, kind: "AUDIO", storage_provider: "b2", object_key: key, size: 1, purged_at: stale, purge_confirmed_at: null, ...overrides,
  });
  const tables: Record<string, Row[]> = {
    submission_files: [
      marked("cut-off", upload(A, "song.wav")),
      marked("in-progress", upload(A, "fresh.wav"), { purged_at: "2026-11-03T11:55:00Z" }),
      marked("done", upload(A, "done.wav"), { purge_confirmed_at: "2026-11-03T11:01:00Z" }),
      marked("shared", upload(A, "shared.wav")),
      { id: "other-live", submission_id: C, kind: "AUDIO", storage_provider: "b2", object_key: upload(A, "shared.wav"), size: 1, purged_at: null },
      marked("certificate", `submissions/${A}/certificate/cert.pdf`, { kind: "ETC" }),
      marked("storage-down", upload(A, "down.wav")),
    ],
    submission_upload_staging: [],
    submission_supplement_files: [
      { id: "supp", object_key: `submissions/supplements/${A}/r/v/u/fix.wav`, purged_at: stale, purge_confirmed_at: null },
    ],
  };
  const { db } = fakeDb(tables);
  const deleted: string[] = [];
  const confirmed = await resumeInterruptedPurges(db, {
    now,
    deleteAllVersions: async key => {
      if (key.endsWith("down.wav")) throw new Error("storage down");
      deleted.push(key);
      return 0;
    },
  });
  const row = (id: string) => [...tables.submission_files, ...tables.submission_supplement_files].find(entry => entry.id === id)!;
  assert.deepEqual(deleted.sort(), [upload(A, "song.wav"), `submissions/supplements/${A}/r/v/u/fix.wav`].sort());
  assert.equal(confirmed, 4);
  for (const id of ["cut-off", "supp", "shared", "certificate"]) assert.ok(row(id).purge_confirmed_at, id);
  assert.equal(row("in-progress").purge_confirmed_at, null, "a purge that may still be running is left alone");
  assert.equal(row("storage-down").purge_confirmed_at, null, "a failed retry stays queued for the next run");
  assert.equal(row("done").purge_confirmed_at, "2026-11-03T11:01:00Z");
});

test("signed downloads are attachments with an extension-based type", async () => {
  const api = await load();
  api.s3.signed.length = 0;
  await api.presignGetUrl(`submissions/${owner}/album/${A}/3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f-proof.pdf`, 300);
  await api.presignGetUrl(`submissions/${owner}/album/${A}/3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f-page.html`, 300);
  await api.presignGetUrl(`submissions/supplements/${A}/r/v/u/fix.wav`, 300, { filename: "수정본 \"최종\".wav" });
  const [pdf, html, named] = api.s3.signed.map(entry => entry.input);
  assert.equal(pdf.ResponseContentDisposition, `attachment; filename="proof.pdf"; filename*=UTF-8''proof.pdf`);
  assert.equal(pdf.ResponseContentType, "application/pdf");
  // An uploaded page is downloaded, never rendered on the storage domain.
  assert.match(String(html.ResponseContentDisposition), /^attachment; filename="page\.html"/);
  assert.equal(html.ResponseContentType, undefined);
  assert.equal(named.ResponseContentType, "audio/wav");
  // Non-ASCII and quotes only fall back to "_" in the legacy parameter.
  assert.equal(named.ResponseContentDisposition, `attachment; filename="___ ____.wav"; filename*=UTF-8''${encodeURIComponent("수정본 \"최종\".wav")}`);
  assert.equal(api.attachmentContentDisposition("a/b\\c\r\n.txt"), `attachment; filename="a_b_c__.txt"; filename*=UTF-8''a_b_c__.txt`);
});

test("all versions and hide markers of exactly one key are deleted across pages", async () => {
  const api = await load();
  const key = "submissions/owner/album/sub/song.wav";
  api.s3.pages.push(
    { Versions: [{ Key: key, VersionId: "v2" }, { Key: `${key}.bak`, VersionId: "x1" }], DeleteMarkers: [{ Key: key, VersionId: "m1" }], IsTruncated: true, NextKeyMarker: key, NextVersionIdMarker: "m1" },
    { Versions: [{ Key: key, VersionId: "v1" }], IsTruncated: false },
  );
  assert.equal(await api.deleteObjectAllVersions(key), 3);
  const deletes = api.s3.sent.filter(entry => entry.command === "DeleteObjectCommand").map(entry => entry.input);
  assert.deepEqual(deletes.map(input => input.VersionId), ["v2", "m1", "v1"]);
  assert.ok(deletes.every(input => input.Key === key && input.Bucket === "bucket"));
  const lists = api.s3.sent.filter(entry => entry.command === "ListObjectVersionsCommand").map(entry => entry.input);
  assert.deepEqual(lists.map(input => [input.Prefix, input.KeyMarker, input.VersionIdMarker]), [[key, undefined, undefined], [key, key, "m1"]]);
});

test("the desk's received scope adds submitted applications still in review, paid or awaiting the deposit, uploads only, and never unpaid ones", async () => {
  const api = await load();
  const fixture = purgeFixture();
  fixture.submissions.push(finishedAlbum(C.replace(/c/g, "e"), { status: "SUBMITTED", payment_status: "UNPAID" }));
  fixture.submission_files.push({ id: "e1", submission_id: C.replace(/c/g, "e"), kind: "AUDIO", storage_provider: "b2", object_key: upload(C.replace(/c/g, "e"), "draft.wav"), size: 10, purged_at: null });
  // A bank-transfer order waiting for the deposit, and a draft that somehow carries the same payment state.
  const F = "ffffffff-ffff-4fff-8fff-ffffffffffff", G = "99999999-9999-4999-8999-999999999999";
  fixture.submissions.push(finishedAlbum(F, { type: "MV_DISTRIBUTION", status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING" }));
  fixture.submissions.push(finishedAlbum(G, { status: "DRAFT", payment_status: "PAYMENT_PENDING" }));
  fixture.submission_files.push({ id: "f1", submission_id: F, kind: "VIDEO", storage_provider: "b2", object_key: upload(F, "mv.mov"), size: 2000, purged_at: null });
  fixture.submission_files.push({ id: "g1", submission_id: G, kind: "AUDIO", storage_provider: "b2", object_key: upload(G, "draft.wav"), size: 10, purged_at: null });
  fixture.submission_supplement_requests.push({ id: "req-b", submission_id: B, status: "SUBMITTED" });
  fixture.submission_supplement_files.push({ id: "sb", request_id: "req-b", object_key: `submissions/supplements/${B}/req-b/rev/u/fix.wav`, size_bytes: 30, purged_at: null });
  const { db } = fakeDb(fixture);
  const finished = await api.loadPurgeCandidates(db);
  assert.deepEqual(finished.map(c => [c.submissionId, c.stage]), [[D, "refunded"], [A, "finished"]]);
  const received = await api.loadPurgeCandidates(db, undefined, "received");
  // Finished and refunded first, oldest first; submissions still in review after them.
  // C's only file sits under another submission's folder, so it is never offered.
  assert.deepEqual(received.map(c => [c.submissionId, c.stage]), [[D, "refunded"], [A, "finished"], [B, "in_review"], [F, "in_review"]]);
  assert.deepEqual(received.map(c => (c as { paymentPending?: boolean }).paymentPending), [false, false, false, true]);
  assert.ok(!received.some(c => c.submissionId === G), "a draft is never offered");
  // In review: the customer's uploads only — the open supplement's file stays until the review ends.
  assert.deepEqual(received.find(c => c.submissionId === B)?.files.map(file => [file.id, file.source]), [["b1", "upload"]]);
  assert.ok(!received.some(c => c.submissionId === C.replace(/c/g, "e")));
});

test("an in-review purge deletes through the received scope only and records why", async () => {
  const api = await load();
  const fixture = purgeFixture();
  const removed: string[] = [];
  const remove = async (key: string) => { removed.push(key); return 1; };
  const { db } = fakeDb(fixture);
  const refused = await api.purgeCustomerFiles(db, [B], owner, remove);
  assert.equal(refused[0].ok, false); assert.equal(removed.length, 0);
  const [result] = await api.purgeCustomerFiles(db, [B], owner, remove, "received");
  assert.deepEqual({ ok: result.ok, deletedFiles: result.deletedFiles, freedBytes: result.freedBytes }, { ok: true, deletedFiles: 1, freedBytes: 100 });
  assert.deepEqual(removed, [upload(B, "song.wav")]);
  assert.ok(fixture.submission_files.find(row => row.id === "b1")?.purged_at);
  assert.match(String(fixture.submission_events.at(-1)?.message), /심의 진행 중 심의 데스크의 원본 보관을 확인하고/);
});
