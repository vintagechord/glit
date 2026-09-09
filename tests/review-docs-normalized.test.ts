import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PizZip from "pizzip";
import { contentDispositionAttachment, generateReviewDocuments, ReviewDocsInputError } from "../src/lib/admin/review-docs";
import { renderReviewDocTemplate } from "../src/lib/admin/review-docs-docx";
import { normalizedReviewFixture, renderingReviewFixture } from "./fixtures/review-docs/normalized";

const xml = (buffer: Buffer) => new PizZip(buffer).file("word/document.xml")!.asText();
const visible = (buffer: Buffer) => xml(buffer).replace(/<[^>]*>/g, "");

test("normalized album generation is side effect free and reports exact ZIP counts", async () => {
  const data = normalizedReviewFixture();
  const saved = JSON.stringify(data);
  const out = await generateReviewDocuments(data);
  assert.equal(JSON.stringify(data), saved);
  assert.deepEqual([out.albumCount, out.trackCount, out.docxCount], [1, 2, 9]);
  assert.equal(out.files.length, 9);
  assert.equal(new PizZip(out.zip, { checkCRC32: true }).file(/\.docx$/).length, 9);
  assert.match(out.templateVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(out.validation, { structureChecked: true, rendered: false });
  for (const code of ["TBS", "WBS", "PBC"]) assert.equal(out.files.filter((file) => file.name.includes(`${code}신청서`)).length, 1);
  const form = out.files.find((f) => f.name.includes("/심의폼_"))!;
  const info = out.files.find((f) => f.name.includes("/앨범정보_"))!;
  assert.equal(xml(form.buffer).replaceAll("빈티지코드", "COMPANY"), xml(info.buffer).replaceAll("검증 제작사", "COMPANY"));
  assert.doesNotMatch(xml(form.buffer), /<w:sz(?:Cs)? w:val="(?!22)\d+"/);
  assert.match(visible(form.buffer), /26\.09\.11/);
  const request = out.files.find((f) => f.name.includes("/가요심의요청서_"))!;
  assert.match(visible(request.buffer), /2026년  09월  07일/);
  assert.match(visible(request.buffer), /2곡/);
  assert.doesNotMatch(visible(request.buffer), /\(타이틀\)/);
  assert.ok(out.files.every((f) => !f.name.includes("타이틀")));
  assert.doesNotMatch(visible(out.files.find((f) => f.name.includes("/02_"))!.buffer), /출력되지 않을 작사가/);
});

test("multi albums preserve all translated repeated lyrics, uncertain dates, no arbitrary title marker", async () => {
  const data = renderingReviewFixture();
  data.albums[1].releaseDate = "9월 중";
  const out = await generateReviewDocuments(data);
  assert.deepEqual([out.albumCount, out.trackCount, out.docxCount], [2, 3, 14]);
  const firstLyrics = visible(out.files.find((f) => f.name.includes("/01_첫 번째 노래"))!.buffer);
  assert.equal((firstLyrics.match(/I love you \(번역 : 나는 너를 사랑해\)/g) ?? []).length, 2);
  assert.match(firstLyrics, /君を待っている \(번역 : 너를 기다리고 있어\)/);
  assert.match(firstLyrics, /62절/);
  const second = visible(out.files.find((f) => f.name.includes("/01_Mr. Sunshine"))!.buffer);
  assert.doesNotMatch(second, /Instrumental|\(타이틀\)/);
  assert.equal((second.match(/같은 마음으로 기다려/g) ?? []).length, 2);
  assert.match(visible(out.files.find((f) => f.name.includes("TBS신청서"))!.buffer), /9월 중/);
});

test("MV single track returns only one minimal lyric DOCX and ZIP without album requirements", async () => {
  const data = normalizedReviewFixture(); data.mode = "mv";
  const album = data.albums[0]; album.artistName = ""; album.title = ""; album.company = "";
  album.releaseDate = ""; album.distributor = ""; album.tracks = [album.tracks[0]];
  album.tracks[0].artistName = "곡별 아티스트";
  const out = await generateReviewDocuments(data);
  assert.equal(out.files.length, 1); assert.equal(out.docxCount, 1);
  assert.match(out.files[0].name, /^영등위_가사\/01_곡별 아티스트 - 첫 번째 노래\.docx$/);
  assert.match(visible(out.files[0].buffer), /곡별 아티스트 - 첫 번째 노래/);
  assert.doesNotMatch(visible(out.files[0].buffer), /담당자|회사|작사가|정준영|010-9068|타이틀|심의신청/);
  assert.doesNotMatch(xml(out.files[0].buffer), /<w:sz(?:Cs)? w:val="(?!22)\d+"/);
});

test("MV does not require album templates and multi-track output contains lyrics only", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv-template-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp("templates/review-docs/lyrics-mv.docx", path.join(directory, "lyrics-mv.docx"));
  const data = normalizedReviewFixture(); data.mode = "mv";
  const out = await generateReviewDocuments(data, { templateDir: directory });
  assert.equal(out.files.length, 2);
  assert.ok(out.files.every((f) => f.name.startsWith("영등위_가사/")));
});

test("filenames keep Korean/Japanese and separate colliding albums and tracks safely", async () => {
  const data = normalizedReviewFixture();
  data.albums[0].title = "../한글:アルバム\u200b";
  data.albums[0].tracks[0].title = '..\\같은/노래:夜?';
  const second = structuredClone(data.albums[0]); second.id = "album-2";
  second.reviewedFields = ["separateAlbum"];
  second.tracks.forEach((track, i) => { track.id = `new-${i}`; });
  data.albums.push(second);
  const out = await generateReviewDocuments(data);
  assert.equal(new Set(out.files.map((f) => f.name)).size, 15);
  assert.ok(out.files.some((f) => /アルバム/.test(f.name)));
  for (const file of out.files) {
    assert.doesNotMatch(file.name, /\.\.|[\\:*?"<>|\u200b\u0000]/);
    assert.equal(file.name.split("/").length, 2);
  }
  assert.match(visible(out.files.find((f) => f.name.includes("/01_"))!.buffer), /\.\.\\같은\/노래:夜\?/);
});

test("unresolved missing lyrics, unconfirmed instrumental and missing translation block generation", async () => {
  for (const change of [
    (d: ReturnType<typeof normalizedReviewFixture>) => { d.albums[0].tracks[0].lyrics = ""; },
    (d: ReturnType<typeof normalizedReviewFixture>) => { d.albums[0].tracks[1].instrumentalConfirmed = false; },
    (d: ReturnType<typeof normalizedReviewFixture>) => { d.albums[0].tracks[0].lyrics = "I love you"; },
  ]) {
    const data = normalizedReviewFixture(); change(data);
    await assert.rejects(() => generateReviewDocuments(data), ReviewDocsInputError);
  }
});

test("four title tracks require explicit WBS selection, while double titles are all listed", async () => {
  const data = normalizedReviewFixture(); const album = data.albums[0];
  album.tracks = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(album.tracks[0]), id: `title-${i}`, number: i + 1, title: `지정곡 ${i + 1}` }));
  await assert.rejects(() => generateReviewDocuments(data), /WBS/);
  album.wbsTrackIds = ["title-3", "title-1", "title-0"];
  const selected = await generateReviewDocuments(data);
  const wbs = visible(selected.files.find((f) => f.name.includes("WBS신청서"))!.buffer);
  assert.match(wbs, /지정곡 4, 지정곡 2, 지정곡 1/);
  album.tracks = album.tracks.slice(0, 2); album.wbsTrackIds = [];
  const double = await generateReviewDocuments(data);
  assert.match(visible(double.files.find((f) => f.name.includes("TBS신청서"))!.buffer), /지정곡 1, 지정곡 2/);
});

test("long lyric rows can split and lyrics-all titles keep their credits without forced pages", async () => {
  const out = await generateReviewDocuments(renderingReviewFixture());
  const form = xml(out.files.find((f) => f.name.includes("/심의폼_"))!.buffer);
  for (const row of form.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)) {
    if (row[0].includes("62절")) assert.doesNotMatch(row[0], /cantSplit|trHeight/);
  }
  assert.doesNotMatch(form, /tblpPr|hRule="exact"/);
  const all = xml(out.files.find((f) => f.name.includes("/가사전체파일_"))!.buffer);
  assert.doesNotMatch(all, /w:type="page"/);
  assert.match(all, /w:keepNext/); assert.match(all, /w:line="276"/);
});

test("adversarial lyric XML and template-looking text remain literal data", async () => {
  const buffer = renderReviewDocTemplate({
    template: await readFile("templates/review-docs/lyrics-mv.docx"), templateName: "lyrics-mv.docx",
    data: { artist_display: "검증 가수", track_title: "검증곡", lyrics_with_translation: '<w:tblpPr/> {lyrics_with_translation} 오늘도 너를 기다려 & "안녕"' },
  });
  assert.match(xml(buffer), /&lt;w:tblpPr\/&gt;/);
  assert.match(xml(buffer), /\{lyrics_with_translation\}/);
  assert.doesNotMatch(xml(buffer), /<w:tblpPr\b/);
  assert.doesNotMatch(contentDispositionAttachment('이름"\\\r\nX-Test: yes.docx'), /[\r\n]/);
});

test("impossible application date is rejected even if it passes the date-shaped string schema", async () => {
  const data = normalizedReviewFixture(); data.applicationDate = "2026-02-30";
  await assert.rejects(() => generateReviewDocuments(data), /신청일자/);
});

test("runtime validation refuses a floating template table", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "unsafe-review-template-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp("templates/review-docs", directory, { recursive: true });
  const file = path.join(directory, "review-form.docx");
  const template = new PizZip(await readFile(file));
  template.file("word/document.xml", template.file("word/document.xml")!.asText().replace("<w:tblPr>", '<w:tblPr><w:tblpPr w:tblpY="0"/>'));
  await writeFile(file, template.generate({ type: "nodebuffer" }));
  await assert.rejects(() => generateReviewDocuments(normalizedReviewFixture(), { templateDir: directory }), /플로팅 표/);
});
