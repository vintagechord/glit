import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";

import { buildMvLyricsDocument, buildReviewDocsZip, contentDispositionAttachment, generateReviewDocuments, REVIEW_DOCS_REPORT_FILENAME, type ReviewDocSubmissionBundle } from "../src/lib/admin/review-docs";
import { buildAttachmentDisposition } from "../src/lib/download-response";
import { assertStrictPackage } from "../tools/onside-desk/tests/strict-package.mjs";
import { normalizedReviewFixture, renderingReviewFixture } from "./fixtures/review-docs/normalized";

// Word on Windows and 한글 hold a document to the schema: properties in the
// schema's order, lines stated on every table and cell, left/right (not
// start/end), a complete theme, and a package without ZIP folder entries.
// LibreOffice, Pages and Polaris forgive all of these, which is how a file
// that would not open on Windows went unnoticed (owner report 2026-11-19).

test("every DOCX of a job generation satisfies a strict reader", async () => {
  for (const data of [normalizedReviewFixture(), renderingReviewFixture()]) {
    const out = await generateReviewDocuments(data, { translate: false });
    assert.ok(out.files.length >= 9);
    for (const file of out.files) assertStrictPackage(file.buffer, file.name);
    for (const [name, entry] of Object.entries(new PizZip(out.zip, { checkCRC32: true }).files)) {
      if (!entry.dir && name.endsWith(".docx")) assertStrictPackage(entry.asNodeBuffer(), `zip › ${name}`);
    }
  }
  const mv = normalizedReviewFixture();
  mv.mode = "mv";
  const lyrics = await generateReviewDocuments(mv, { translate: false });
  for (const file of lyrics.files) assertStrictPackage(file.buffer, `mv › ${file.name}`);
});

test("the submission ZIP and the MV lyric sheet satisfy a strict reader too", async () => {
  const bundle: ReviewDocSubmissionBundle = {
    submission: { id: "strict", type: "ALBUM", title: "가을의 노래 (Autumn)", artist_name: "검증 가수", release_date: "2026-12-01", genre: "발라드", distributor: "유통사", production_company: "제작사" },
    tracks: [
      { track_no: 1, track_title: "첫 번째 노래", is_title: true, lyricist: "작사가", composer: "작곡가", arranger: "편곡가", lyrics: "첫 줄 & <둘째> \"셋째\"\nStay with me\n君を待っている 🎵" },
      { track_no: 2, track_title: "첫 번째 노래 (Inst.)", composer: "작곡가", lyrics: "" },
    ],
    files: [], events: [],
  };
  const zip = new PizZip(await buildReviewDocsZip([bundle], { translate: async (batch) => batch.map(() => "번역") }), { checkCRC32: true });
  const documents = Object.entries(zip.files).filter(([name, entry]) => !entry.dir && name.endsWith(".docx"));
  assert.equal(documents.length, 9);
  for (const [name, entry] of documents) assertStrictPackage(entry.asNodeBuffer(), name);
  assert.equal(zip.file(REVIEW_DOCS_REPORT_FILENAME), null);

  const sheet = await buildMvLyricsDocument(
    { id: "strict-mv", type: "MV_DISTRIBUTION", artist_name_kr: "슬로울리(slowly)", mv_song_title_official: "아름다운 이별 (A Beautiful Farewell)", mv_lyrics: "눈물이 흘러\nStay with me" },
    { translate: async (batch) => batch.map(() => "내 곁에 있어줘") },
  );
  assertStrictPackage(sheet.buffer, sheet.filename);
});

test("download names with parentheses and quotes are encoded the way RFC 5987 requires", () => {
  const name = "심의자료_슬로울리(slowly)_It's *OK*!.zip";
  for (const header of [contentDispositionAttachment(name), buildAttachmentDisposition(name)]) {
    const encoded = header.split("filename*=UTF-8''")[1];
    assert.match(encoded, /^[A-Za-z0-9%._~-]+$/);
    assert.equal(decodeURIComponent(encoded), name);
  }
});
