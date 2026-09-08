import test from "node:test";
import assert from "node:assert/strict";
import { createArchiveData, applyArchiveCommand } from "../src/lib/music-archive/model";
import { parseArchiveCsv, previewArchiveCsv, importArchiveCsv } from "../src/lib/music-archive/csv";

const csv = "release_key,release_title,track_key,track_title,version,isrc\nr1,Same,t1,Same,original,\nr2,Same,t2,Same,live,";
test("CSV uses explicit distributor keys, never album or song titles for dedup", () => {
  const data = importArchiveCsv(csv, createArchiveData("Artist"));
  assert.equal(data.releases.length, 2); assert.equal(data.tracks.length, 2); assert.equal(data.recordings.length, 2);
  assert.equal(data.tasks.length, 0); assert.notEqual(data.tracks[0].recordingId, data.tracks[1].recordingId);
  assert.equal(previewArchiveCsv(csv, data).duplicateCount, 2);
  assert.deepEqual(importArchiveCsv(csv, data), data);
});
test("CSV preview exposes individual errors and import is all-or-nothing", () => {
  const data = createArchiveData("Artist");
  const invalid = "release_key,release_title,track_key,track_title,track_number\nr1,First,t1,Song,1\nr2,Second,,Song,zero";
  const preview = previewArchiveCsv(invalid, data);
  assert.equal(preview.errorCount, 1); assert.equal(preview.rows[1].rowNumber, 3);
  assert.throws(() => importArchiveCsv(invalid, data)); assert.equal(data.releases.length, 0);
});
test("CSV stable-key conflict cannot silently overwrite a manual version and results", () => {
  let data = importArchiveCsv(csv, createArchiveData("Artist"));
  data = applyArchiveCommand(data, { type: "set_excluded", entityType: "track", id: data.tracks[0].id, excluded: true });
  assert.equal(importArchiveCsv(csv, data).tracks[0].excluded, true);
  assert.throws(() => importArchiveCsv(csv.replace("original", "remix"), data));
});
test("CSV handles quoted commas/newlines without evaluating formula-like text", () => {
  assert.deepEqual(parseArchiveCsv('a,b\n"hello,world","line\nnext"'), [["a", "b"], ["hello,world", "line\nnext"]]);
  assert.deepEqual(parseArchiveCsv('a,b\n=SUM(1),"""quoted"""'), [["a", "b"], ["=SUM(1)", '"quoted"']]);
  assert.throws(() => parseArchiveCsv('a\n"unclosed'));
  assert.throws(() => parseArchiveCsv('a\n"closed"bad'));
});
test("conflicting explicit work identifiers are review errors rather than silent merges", () => {
  const csv = "release_key,release_title,track_key,track_title,work_key,work_title,writers\nr1,Album,t1,Song,w1,Work,A\nr1,Album,t2,Song,w1,Other,B";
  const archive = createArchiveData("Artist");
  assert.equal(previewArchiveCsv(csv, archive).errorCount, 1);
  assert.throws(() => importArchiveCsv(csv, archive));
});
