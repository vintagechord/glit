import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

type Row = Record<string, unknown>;
type PurgeApi = {
  reviewFinishedAt: (submission: Row, reviews: Row[], requests: Row[]) => string | null;
  selectPurgeFiles: (submissionId: string, uploads: Row[], supplements: Row[], prefix: string) => Array<{ source: string; id: string; objectKey: string }>;
  purgeCustomerFiles: (db: unknown, ids: string[], actor: string, remove: (key: string) => Promise<number>) => Promise<Array<{ submissionId: string; ok: boolean; deletedFiles: number; failedFiles: number; freedBytes: number; error?: string }>>;
  deleteObjectAllVersions: (key: string) => Promise<number>;
  s3: { pages: Array<{ Versions?: Row[]; DeleteMarkers?: Row[]; IsTruncated?: boolean; NextKeyMarker?: string; NextVersionIdMarker?: string }>; sent: Array<{ command: string; input: Row }> };
};

async function load(): Promise<PurgeApi> {
  Object.assign(process.env, {
    B2_S3_ENDPOINT: "https://s3.fixture.invalid", B2_REGION: "fixture", B2_BUCKET: "bucket",
    B2_PREFIX: "submissions/", B2_KEY_ID: "id", B2_APPLICATION_KEY: "key",
  });
  const bundle = await build({
    stdin: {
      contents: "export * from './src/lib/admin/customer-file-purge'; export { deleteObjectAllVersions } from './src/lib/b2'; export { s3 } from 's3-fixture';",
      resolveDir: process.cwd(), loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "s3-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(s3-fixture|@aws-sdk\/client-s3|@aws-sdk\/s3-request-presigner)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        if (path === "s3-fixture") return { loader: "js", contents: "export const s3={pages:[],sent:[]};" };
        if (path === "@aws-sdk/s3-request-presigner") return { loader: "js", contents: "export const getSignedUrl=async()=>'https://signed.invalid';" };
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
const owner = "11111111-1111-4111-8111-111111111111";
const upload = (submissionId: string, name: string) => `submissions/${owner}/album/${submissionId}/${name}`;
const finishedAlbum = (id: string, overrides: Row = {}): Row => ({
  id, title: `album ${id.slice(0, 1)}`, artist_name: "artist", type: "ALBUM", status: "RESULT_READY", payment_status: "PAID",
  result_status: null, result_notified_at: null, mv_desired_rating: null, updated_at: "2026-10-01T00:00:00Z", ...overrides,
});

test("a review counts as finished only when paid, fully decided and free of open supplement requests", async () => {
  const { reviewFinishedAt } = await load();
  const decided = [
    { submission_id: A, status: "APPROVED", updated_at: "2026-10-05T00:00:00Z" },
    { submission_id: A, status: "REJECTED", updated_at: "2026-10-07T00:00:00Z" },
  ];
  assert.equal(reviewFinishedAt(finishedAlbum(A), decided, []), "2026-10-07T00:00:00Z");
  assert.equal(reviewFinishedAt(finishedAlbum(A, { result_notified_at: "2026-10-09T00:00:00Z" }), decided, [{ status: "ACCEPTED" }]), "2026-10-09T00:00:00Z");
  assert.equal(reviewFinishedAt(finishedAlbum(A), [], []), "2026-10-01T00:00:00Z");

  assert.equal(reviewFinishedAt(finishedAlbum(A, { payment_status: "REFUNDED" }), decided, []), null);
  assert.equal(reviewFinishedAt(finishedAlbum(A, { status: "IN_PROGRESS" }), decided, []), null);
  for (const pending of ["NOT_SENT", "SENT", "RECEIVED", "NEEDS_FIX"]) {
    assert.equal(reviewFinishedAt(finishedAlbum(A), [...decided, { submission_id: A, status: pending, updated_at: null }], []), null, pending);
  }
  for (const open of ["OPEN", "SUBMITTED"]) {
    assert.equal(reviewFinishedAt(finishedAlbum(A), decided, [{ status: open }]), null, open);
  }

  const onlineMv = finishedAlbum(A, { type: "MV_DISTRIBUTION", status: "IN_PROGRESS", result_status: "APPROVED", mv_desired_rating: "15" });
  assert.ok(reviewFinishedAt(onlineMv, [{ submission_id: A, status: "SENT", updated_at: null }], []));
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
  submissions: [finishedAlbum(A), finishedAlbum(B, { status: "IN_PROGRESS" }), finishedAlbum(C, { status: "IN_PROGRESS" })],
  station_reviews: [{ id: "r1", submission_id: A, status: "APPROVED", updated_at: "2026-10-05T00:00:00Z" }],
  submission_files: [
    { id: "a1", submission_id: A, kind: "AUDIO", storage_provider: "b2", object_key: upload(A, "song.wav"), size: 100, purged_at: null },
    { id: "a2", submission_id: A, kind: "LYRICS", storage_provider: "b2", object_key: upload(A, "lyrics.docx"), size: 20, purged_at: null },
    { id: "a3", submission_id: A, kind: "VIDEO", storage_provider: "b2", object_key: upload(A, "shared.mp4"), size: 50, purged_at: null },
    { id: "c1", submission_id: C, kind: "VIDEO", storage_provider: "b2", object_key: upload(A, "shared.mp4"), size: 50, purged_at: null },
    { id: "b1", submission_id: B, kind: "AUDIO", storage_provider: "b2", object_key: upload(B, "song.wav"), size: 100, purged_at: null },
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
  const results = await purgeCustomerFiles(db, [A, B], "admin-user", async key => {
    attempted.push(key);
    const rows = [...tables.submission_files, ...tables.submission_supplement_files].filter(row => row.object_key === key && row.id !== "c1");
    assert.ok(rows.every(row => row.purged_at), "rows are marked before the object is deleted");
    if (key.endsWith("lyrics.docx")) throw new Error("storage down");
    return 2;
  });

  assert.deepEqual(attempted.sort(), [upload(A, "lyrics.docx"), upload(A, "song.wav"), `submissions/supplements/${A}/req/rev/u/fix.wav`].sort());
  const file = (id: string) => [...tables.submission_files, ...tables.submission_supplement_files].find(row => row.id === id)!;
  assert.ok(file("a1").purged_at);
  assert.ok(file("s1").purged_at);
  assert.equal(file("a2").purged_at, null, "a failed delete stays downloadable and retryable");
  assert.equal(file("a3").purged_at, null, "an object another live row uses is kept");
  assert.equal(file("b1").purged_at, null);

  const [resultA, resultB] = results;
  assert.deepEqual({ ...resultA, error: undefined }, { submissionId: A, ok: false, deletedFiles: 2, failedFiles: 1, freedBytes: 130, error: undefined });
  assert.equal(resultB.ok, false);
  assert.match(resultB.error ?? "", /심의가 끝나지 않았거나/);
  assert.equal(tables.submission_events.length, 1);
  assert.equal(tables.submission_events[0].event_type, "CUSTOMER_FILES_PURGED");
  assert.equal(tables.submission_events[0].actor_user_id, "admin-user");
  assert.match(String(tables.submission_events[0].message), /2개/);
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
