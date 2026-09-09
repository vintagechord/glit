import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAudioUploadFile, isReleasedAlbumAudioFile, isStoredReleasedAlbumAudioFile } from "../src/lib/submission-files";
import { validateSubmittedFiles } from "../src/lib/submission-required-fields";
import { validateReleasedAlbumPaymentFiles } from "../src/lib/submission-payment-files";

const requiredMessage = "음원 파일(WAV 또는 ZIP)을 사이트에 업로드해주세요.";
const uploaded = { submission_id: "released-a", original_name: "master.wav", mime: "audio/wav", status: "UPLOADED", file_path: "owner/released-a/master.wav", size: 1234, kind: "AUDIO" };
type Row = Record<string, unknown>;
function dbFixture(albums: Row[], files: Row[], failTable?: string) {
  const calls: string[] = [];
  return { calls, db: { from(table: string) {
    calls.push(table);
    let rows = table === "submissions" ? albums : files;
    const chain = {
      select() { return chain; },
      in(column: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[column])); return chain; },
      eq(column: string, value: unknown) { rows = rows.filter(row => row[column] === value); return chain; },
      order() { return chain; },
      range(start: number, end: number) { rows = rows.slice(start, end + 1); return chain; },
      then(resolve: (result: { data: Row[] | null; error: { message: string } | null }) => unknown) { return Promise.resolve({ data: table === failTable ? null : rows, error: table === failTable ? { message: "database unavailable" } : null }).then(resolve); },
    };
    return chain;
  } } as unknown as Parameters<typeof validateReleasedAlbumPaymentFiles>[0] };
}
const album = (id = "released-a", isOneClick = true) => ({ id, type: "ALBUM", is_oneclick: isOneClick });

test("released master validation accepts WAV/ZIP and rejects MP3 or conflicting file metadata", () => {
  for (const [name, mime] of [["master.WAV", "audio/x-wav"], ["master.wav", "application/octet-stream"], ["masters.zip", "application/zip"], ["masters.zip", ""], ["", "audio/wav"]]) assert.equal(isReleasedAlbumAudioFile(name, mime), true, `${name}/${mime}`);
  for (const [name, mime] of [["master.mp3", "audio/mpeg"], ["master.mp3", "audio/wav"], ["form.docx", "application/zip"], ["master.wav", "application/zip"], ["masters.zip", "audio/mpeg"], ["", "application/octet-stream"]]) assert.equal(isReleasedAlbumAudioFile(name, mime), false, `${name}/${mime}`);
  assert.equal(isAudioUploadFile("master.mp3", "audio/mpeg"), true, "pre-release audio formats remain unchanged");
});

test("released final submission accepts an explicit email handoff while retaining audio format validation", () => {
  for (const flags of [{}, { filesSubmittedByEmail: true }, { isAdminReviewer: true }, { filesSubmittedByEmail: true, isAdminReviewer: true }, { externalApplicationForm: true }]) {
    const input = { kind: "ALBUM" as const, isOneClick: true, isAdminReviewer: false, filesSubmittedByEmail: false, ...flags };
    const expected = input.filesSubmittedByEmail ? null : requiredMessage;
    assert.equal(validateSubmittedFiles({ ...input, files: [] }), expected);
    assert.equal(validateSubmittedFiles({ ...input, files: [{ originalName: "master.mp3", mime: "audio/mpeg" }] }), expected);
    assert.equal(validateSubmittedFiles({ ...input, files: [{ originalName: "masters.zip", mime: "application/zip" }] }), null);
  }
  assert.equal(validateSubmittedFiles({ kind: "ALBUM", isOneClick: false, isAdminReviewer: false, filesSubmittedByEmail: true, files: [] }), null);
});

test("persisted legacy media is accepted, pending/failed/zero-byte metadata is rejected", () => {
  assert.equal(isStoredReleasedAlbumAudioFile(uploaded), true);
  assert.equal(isStoredReleasedAlbumAudioFile({ ...uploaded, status: null, size: null }), true);
  assert.equal(isStoredReleasedAlbumAudioFile({ ...uploaded, original_name: null }), true);
  for (const status of ["PENDING", "UPLOADING", "FAILED", "ERROR"]) assert.equal(isStoredReleasedAlbumAudioFile({ ...uploaded, status }), false);
  assert.equal(isStoredReleasedAlbumAudioFile({ ...uploaded, size: 0 }), false);
  assert.equal(isStoredReleasedAlbumAudioFile({ ...uploaded, file_path: "", object_key: "" }), false);
});

test("checkout requires saved WAV/ZIP for every released album and never borrows another submission's file", async () => {
  const missing = dbFixture([album()], []);
  assert.equal(await validateReleasedAlbumPaymentFiles(missing.db, ["released-a"]), requiredMessage);
  const another = dbFixture([album()], [{ ...uploaded, submission_id: "other-member-album" }]);
  assert.equal(await validateReleasedAlbumPaymentFiles(another.db, ["released-a"]), requiredMessage);
  const mixed = dbFixture([album(), album("released-b"), album("prerelease", false)], [uploaded]);
  assert.equal(await validateReleasedAlbumPaymentFiles(mixed.db, ["released-a", "released-b", "prerelease"]), requiredMessage);
  const ready = dbFixture([album(), album("released-b")], [uploaded, { ...uploaded, submission_id: "released-b", original_name: "masters.zip", mime: "application/zip" }]);
  assert.equal(await validateReleasedAlbumPaymentFiles(ready.db, ["released-a", "released-b"]), null);
});

test("checkout rejects incomplete upload rows and fails closed on database errors", async () => {
  for (const status of ["UPLOADING", "FAILED"]) {
    const fixture = dbFixture([album()], [{ ...uploaded, status }]);
    assert.equal(await validateReleasedAlbumPaymentFiles(fixture.db, ["released-a"]), requiredMessage);
  }
  for (const table of ["submissions", "submission_files"]) {
    const fixture = dbFixture([album()], [uploaded], table);
    assert.match((await validateReleasedAlbumPaymentFiles(fixture.db, ["released-a"])) ?? "", /상태를 확인할 수 없습니다/);
  }
  const prerelease = dbFixture([album("prerelease", false)], []);
  assert.equal(await validateReleasedAlbumPaymentFiles(prerelease.db, ["prerelease"]), null);
  assert.deepEqual(prerelease.calls, ["submissions"]);
});

test("card, bank and PayPal entry points check persisted audio before starting payment", () => {
  const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const [file, start, mutation] of [
    ["src/lib/payments/submission.ts", "export const createSubmissionPaymentOrder", '"begin_submission_payment_order"'],
    ["src/app/api/cart/bank/route.ts", "export async function POST", '"begin_submission_bank_payment"'],
    ["src/lib/payments/paypal.ts", "export const createPayPalOrderForSubmission", "const accessToken = await getAccessToken()"],
  ]) {
    const source = read(file).slice(read(file).indexOf(start));
    const checkIndex = source.indexOf("await validateReleasedAlbumPaymentFiles(");
    assert.ok(checkIndex > 0 && checkIndex < source.indexOf(mutation), `${file} must check before payment side effects`);
    assert.ok(source.slice(checkIndex, source.indexOf(mutation)).includes("if (mediaError)"), `${file} must return the blocking result`);
  }
});


test("large checkout bundles continue past the first stored-file result page", async () => {
  const files = [...Array.from({ length: 500 }, () => ({ ...uploaded })), { ...uploaded, submission_id: "released-b" }];
  const fixture = dbFixture([album(), album("released-b")], files);
  assert.equal(await validateReleasedAlbumPaymentFiles(fixture.db, ["released-a", "released-b"]), null);
  assert.equal(fixture.calls.filter(table => table === "submission_files").length, 2);
});


test("checkout accepts saved email handoffs without waiting for failed or pending audio uploads", async () => {
  const byEmail = { ...album(), files_submitted_by_email: true };
  for (const files of [[], [{ ...uploaded, status: "UPLOADING" }], [{ ...uploaded, status: "FAILED" }]]) {
    const fixture = dbFixture([byEmail], files);
    assert.equal(await validateReleasedAlbumPaymentFiles(fixture.db, ["released-a"]), null);
    assert.deepEqual(fixture.calls, ["submissions"], "an email handoff must not require upload completion");
  }
  const mixed = dbFixture([byEmail, album("released-b")], [{ ...uploaded, submission_id: "released-b" }]);
  assert.equal(await validateReleasedAlbumPaymentFiles(mixed.db, ["released-a", "released-b"]), null);
  const missing = dbFixture([byEmail, album("released-b")], []);
  assert.equal(await validateReleasedAlbumPaymentFiles(missing.db, ["released-a", "released-b"]), requiredMessage,
    "one album's email handoff does not exempt another album");
});
