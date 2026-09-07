import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import PizZip from "pizzip";
import { buildReviewDocsZip, generateReviewDocuments } from "../src/lib/admin/review-docs";
import { normalizedReviewFixture } from "./fixtures/review-docs/normalized";

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

test("review documents preserve the legacy artist fallback and normalized missing performer blanks", async () => {
  const performerCell = (buffer: Buffer) => {
    const document = new PizZip(buffer).file("word/document.xml")!.asText();
    const cells = [...document.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((match) => match[0].replace(/<[^>]*>/g, ""));
    const template = new PizZip(readFileSync(new URL("../templates/review-docs/review-form.docx", import.meta.url))).file("word/document.xml")!.asText();
    const templateCells = [...template.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((match) => match[0].replace(/<[^>]*>/g, ""));
    return cells[templateCells.findIndex((cell) => cell === "{performer}")];
  };
  const legacy = new PizZip(await buildReviewDocsZip([{ submission: { title: "앨범", artist_name: "기본 가수" }, tracks: [{ track_no: 1, track_title: "노래", lyrics: "가사" }], files: [], events: [] }]));
  assert.equal(performerCell(legacy.file(/심의폼_.*\.docx$/)[0].asNodeBuffer()), "기본 가수");
  const data = normalizedReviewFixture(); data.albums[0].tracks = [data.albums[0].tracks[0]];
  const normalized = await generateReviewDocuments(data);
  assert.equal(performerCell(normalized.files.find((file) => file.name.includes("/심의폼_"))!.buffer), "");
  data.albums[0].tracks[0].performers = "명시한 실연자";
  const specified = await generateReviewDocuments(data);
  assert.equal(performerCell(specified.files.find((file) => file.name.includes("/심의폼_"))!.buffer), "명시한 실연자");
});
