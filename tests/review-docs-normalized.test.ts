import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PizZip from "pizzip";
import { contentDispositionAttachment, generateReviewDocuments, REVIEW_DOCS_REPORT_FILENAME, ReviewDocsInputError } from "../src/lib/admin/review-docs";
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
  // Nothing to check: no report, and no report file in the ZIP.
  assert.deepEqual(out.report, []);
  assert.equal(new PizZip(out.zip).file(REVIEW_DOCS_REPORT_FILENAME), null);
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
  // PBC's 「심의 음반 접수 목록」 carries the release date (비고).
  assert.match(visible(out.files.find((f) => f.name.includes("PBC신청서"))!.buffer), /9월 중/);
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

test("unresolved items never block generation: the documents are made and the items come back in the report", async () => {
  const lyricsText = (out: Awaited<ReturnType<typeof generateReviewDocuments>>, prefix: string) =>
    visible(out.files.find((f) => f.name.includes(`/${prefix}_`))!.buffer);
  const reportFile = (out: Awaited<ReturnType<typeof generateReviewDocuments>>) =>
    new PizZip(out.zip).file(REVIEW_DOCS_REPORT_FILENAME)?.asText() ?? "";

  // A vocal track without lyrics prints a visible placeholder.
  const noLyrics = normalizedReviewFixture(); noLyrics.albums[0].tracks[0].lyrics = "";
  const first = await generateReviewDocuments(noLyrics, { translate: false });
  assert.deepEqual([first.albumCount, first.trackCount, first.docxCount], [1, 2, 9]);
  assert.match(lyricsText(first, "01"), /가사 입력 필요/);
  assert.equal(first.report.length, 1);
  assert.match(first.report[0], /가을의 노래 · 1번 첫 번째 노래: .*가사.*→ 문서에는 '가사 입력 필요'로 출력했습니다\./);
  assert.match(reportFile(first), /심의자료는 모두 생성되었습니다[\s\S]*1\. 가을의 노래 · 1번 첫 번째 노래/);
  assert.equal(new PizZip(first.zip, { checkCRC32: true }).file(/\.docx$/).length, 9);

  // An Inst. track nobody confirmed still prints 가사 없음, without a lyricist.
  const unconfirmed = normalizedReviewFixture(); unconfirmed.albums[0].tracks[1].instrumentalConfirmed = false;
  const second = await generateReviewDocuments(unconfirmed, { translate: false });
  assert.match(lyricsText(second, "02"), /가사 없음 \/ Instrumental/);
  assert.doesNotMatch(lyricsText(second, "02"), /출력되지 않을 작사가/);
  assert.ok(second.report.some((line) => /2번 두 번째 노래 \(Inst\.\): .*'가사 없음 \/ Instrumental'\(으\)로 출력했습니다\./.test(line)), second.report.join("\n"));

  // An instrumental that came with lyric text: the lyrics are not printed, and the report says so.
  const conflict = normalizedReviewFixture(); conflict.albums[0].tracks[1].lyrics = "라라라 가사가 있다";
  const third = await generateReviewDocuments(conflict, { translate: false });
  assert.match(lyricsText(third, "02"), /가사 없음 \/ Instrumental/);
  assert.doesNotMatch(lyricsText(third, "02"), /라라라/);
  assert.ok(third.report.some((line) => /연주곡 표시와 가사가 함께 있습니다.*가사는 출력하지 않고/.test(line)), third.report.join("\n"));

  // Foreign lyrics without a translation are translated during generation; the original stays as written.
  const foreign = normalizedReviewFixture(); foreign.albums[0].tracks[0].lyrics = "I love you\n君を愛してる\n너를 사랑해";
  const asked: string[] = [];
  const fourth = await generateReviewDocuments(foreign, { translate: async (batch) => { asked.push(...batch); return batch.map(() => "사랑해"); } });
  assert.deepEqual(asked, ["I love you", "君を愛してる"]);
  assert.match(lyricsText(fourth, "01"), /I love you \(번역 : 사랑해\)\s*君を愛してる \(번역 : 사랑해\)\s*너를 사랑해/);
  assert.deepEqual(fourth.report, ['가을의 노래 · 1번 첫 번째 노래: 외국어 가사 2구간을 자동 번역해 "(번역 : …)"으로 넣었습니다. 번역 내용을 확인해주세요.']);
  assert.equal(JSON.stringify(foreign.albums[0].tracks[0].lyrics), JSON.stringify("I love you\n君を愛してる\n너를 사랑해"));

  // When the translation service fails, the documents still come out with the original text.
  const fifth = await generateReviewDocuments(foreign, { translate: async () => { throw new Error("offline"); } });
  assert.match(lyricsText(fifth, "01"), /I love you\s*君を愛してる\s*너를 사랑해/);
  assert.doesNotMatch(lyricsText(fifth, "01"), /번역 :/);
  assert.match(fifth.report[0], /1번 첫 번째 노래: 외국어 가사 2구간을 번역하지 못해 원문 그대로 출력했습니다/);
  assert.match(fifth.report[1], /^번역 실패 사유: /);

  // Only a job without a single song has nothing to generate.
  const empty = normalizedReviewFixture(); empty.albums[0].tracks = [];
  await assert.rejects(() => generateReviewDocuments(empty, { translate: false }), ReviewDocsInputError);
});

test("four title tracks fall back to the first three for WBS until a selection is made, while double titles are all listed", async () => {
  const data = normalizedReviewFixture(); const album = data.albums[0];
  album.tracks = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(album.tracks[0]), id: `title-${i}`, number: i + 1, title: `지정곡 ${i + 1}` }));
  // Without a selection the first three title tracks are used, and the report asks for the choice.
  const unselected = await generateReviewDocuments(data);
  assert.match(visible(unselected.files.find((f) => f.name.includes("WBS신청서"))!.buffer), /지정곡 1, 지정곡 2, 지정곡 3/);
  assert.ok(unselected.report.some((line) => /WBS 신청곡을 최대 3곡 선택해주세요.*앞의 3곡/.test(line)), unselected.report.join("\n"));
  album.wbsTrackIds = ["title-3", "title-1", "title-0"];
  const selected = await generateReviewDocuments(data);
  const wbs = visible(selected.files.find((f) => f.name.includes("WBS신청서"))!.buffer);
  assert.match(wbs, /지정곡 4, 지정곡 2, 지정곡 1/);
  album.tracks = album.tracks.slice(0, 2); album.wbsTrackIds = [];
  const double = await generateReviewDocuments(data);
  assert.match(visible(double.files.find((f) => f.name.includes("PBC신청서"))!.buffer), /지정곡 1, 지정곡 2/);
  // TBS's 「음원심의신청서」 has two title slots.
  assert.match(visible(double.files.find((f) => f.name.includes("TBS신청서"))!.buffer), /지정곡 1\s*지정곡 2/);
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

test("an impossible application date prints today's date and is reported", async () => {
  const data = normalizedReviewFixture(); data.applicationDate = "2026-02-30";
  const out = await generateReviewDocuments(data);
  assert.equal(out.docxCount, 9);
  assert.doesNotMatch(visible(out.files.find((f) => f.name.includes("/가요심의요청서_"))!.buffer), /02월\s+30일/);
  assert.ok(out.report.some((line) => /신청일자가 유효하지 않습니다.*오늘 날짜로 출력했습니다/.test(line)), out.report.join("\n"));
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
