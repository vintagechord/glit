import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import PizZip from "pizzip";
import { extractFiles, extractFileBlocks, structureExtractedFile, validateReviewUpload } from "../src/lib/review-docs/extract";
import { canonicalReviewUrls, createReviewUrlFetcher, extractUrls } from "../src/lib/review-docs/urls";
import { emptyReviewData, explicitInstrumental, explicitTitle, foreignLyricSpans, normalizeReviewDate, reviewAlbumSchema, seoulApplicationDate, validateReviewData } from "../src/lib/review-docs/model";
import { renderTrackLyrics, translateReviewData } from "../src/lib/review-docs/translation";

const fixture = async (name: string, id = name) => ({ id, name, mime: "", buffer: await readFile(path.join(process.cwd(), "tests/fixtures/review-docs", name)) });
const python = !!process.env.REVIEW_DOCS_PYTHON;
const source = { id: "source", kind: "file" as const, name: "synthetic", text: "", warnings: [] };
const createData = (lyrics = "한국어 가사") => {
  const data = emptyReviewData("mv", "2026-09-07");
  data.albums = [reviewAlbumSchema.parse({ id: "a", artistName: "가수", tracks: [{ id: "t", number: 1, title: "곡명", lyrics, lyricStatus: "provided" }] })];
  return data;
};
test("title/instrumental and calendar decisions do not guess from labels or Mr.", () => {
  for (const value of ["□", "X", "-", "타이틀 여부", "타이틀", "title"]) assert.equal(explicitTitle(value), false);
  assert.equal(explicitTitle("☑☒"), true);
  assert.equal(explicitInstrumental("Mr. Moon"), false);
  assert.equal(explicitInstrumental("The instrumental story"), false);
  assert.equal(explicitInstrumental("노래 (Inst.)"), true);
  assert.equal(normalizeReviewDate("9월 중"), "9월 중");
  assert.equal(normalizeReviewDate("2026.09.07"), "2026-09-07");
  assert.equal(seoulApplicationDate(new Date("2026-09-06T15:00:00Z")), "2026-09-07");
  const data = createData(); data.mode = "album"; data.albums[0].releaseDate = "2026-99-99";
  assert.ok(validateReviewData(data).some((i) => i.code === "DATE_UNCERTAIN"));
});
test("empty/failing lyrics and false source evidence block; MV missing album metadata does not", () => {
  const data = createData();
  assert.equal(validateReviewData(data).filter((i) => i.severity === "error").length, 0);
  data.albums[0].tracks[0].lyrics = "";
  assert.ok(validateReviewData(data).some((i) => i.code === "LYRICS_REQUIRED"));
  data.albums[0].tracks[0].evidence = [{ sourceId: "fake", field: "title", location: "page1", excerpt: "" }];
  assert.ok(validateReviewData(data).some((i) => i.code === "EVIDENCE_INVALID"));
});
test("upload magic/MIME/active OOXML/path/XXE validation rejects disguised documents", async () => {
  assert.throws(() => validateReviewUpload({ name: "fake.docx", mime: "", buffer: Buffer.from("{\\rtf1 fake}") }), /시그니처/);
  const file = await fixture("table-two-tracks.docx");
  assert.throws(() => validateReviewUpload({ ...file, mime: "application/pdf" }), /MIME/);
  for (const [name, content] of [["word/vbaProject.bin", "macro"], ["../evil.xml", "escape"], ["word/document.xml", '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>']]) {
    const archive = new PizZip(file.buffer); archive.file(name, content);
    await assert.rejects(extractFileBlocks({ ...file, buffer: archive.generate({ type: "nodebuffer" }) }), /매크로|압축 경로|엔티티/);
  }
});
test("real DOCX tables and content controls retain credits, repeated lyrics and unchecked title", async () => {
  const data = await extractFiles([await fixture("table-two-tracks.docx")], "album", "2026-09-07");
  assert.equal(data.albums.length, 1);
  const album = data.albums[0]; assert.equal(album.tracks.length, 2);
  assert.equal(album.tracks[0].lyrics, "반복 가사\n반복 가사\n끝 가사");
  assert.equal(album.tracks[1].lyrics, "달빛을 따라\n다시 달빛을 따라");
  assert.equal(album.tracks[0].isTitle, true); assert.equal(album.tracks[1].isTitle, false);
  assert.equal(album.tracks[1].instrumentalConfirmed, false);
  assert.ok(album.tracks[0].evidence.some((e) => e.location.includes("row:")));
});
test("multi-file album/revision conflicts preserve source evidence and avoid duplicate albums", async () => {
  const data = await extractFiles([await fixture("table-two-tracks.docx"), await fixture("conflicting-revision.docx")], "album", "2026-09-07");
  assert.equal(data.albums.length, 1); assert.equal(data.albums[0].tracks.length, 2);
  assert.equal(data.albums[0].sourceIds.length, 2);
  assert.ok(data.issues.some((i) => i.code === "TRACK_REVISION_CONFLICT"));
  assert.ok(data.issues.some((i) => i.code === "FIELD_CONFLICT"));
});
test("one file supports multiple albums and declared track-count mismatch blocks", async () => {
  const multi = await extractFiles([await fixture("multiple-albums.docx")], "album", "2026-09-07");
  assert.equal(multi.albums.length, 2); assert.equal(multi.albums[1].tracks[0].lyrics, "다음 앨범 가사");
  const mismatch = await extractFiles([await fixture("track-count-mismatch.docx")], "album", "2026-09-07");
  assert.ok(validateReviewData(mismatch).some((i) => i.code === "TRACK_COUNT_MISMATCH"));
});
test("real RTF Word, compressed HWP full body/table, Korean PDF, and scan config error", { skip: !python && "Set REVIEW_DOCS_PYTHON to the pinned converter venv to run actual converter fixtures." }, async () => {
  const rtf = await extractFiles([await fixture("rtf-word.doc")], "mv", "2026-09-07");
  assert.equal(rtf.sources[0].format, "rtf-doc");
  assert.equal(rtf.albums[0].tracks[0].lyrics, "반복 구절\n반복 구절");
  if (spawnSync("antiword", ["-h"], { stdio: "ignore" }).error?.message.includes("ENOENT") !== true) {
    const binary = await extractFiles([await fixture("binary-word.doc")], "album", "2026-09-07");
    assert.equal(binary.sources[0].format, "binary-doc"); assert.equal(binary.albums[0].tracks.length, 2);
    assert.equal(binary.albums[0].tracks[0].lyrics, "반복 가사\n반복 가사\n끝 가사");
    assert.equal(binary.albums[0].tracks[1].isTitle, false); assert.equal(binary.albums[0].tracks[1].instrumentalConfirmed, false);
  } else {
    await assert.rejects(extractFileBlocks(await fixture("binary-word.doc")), /antiword/);
  }
  const hwp = await extractFiles([await fixture("multiple-tracks.hwp")], "album", "2026-09-07");
  assert.equal(hwp.sources[0].format, "hwp5"); assert.equal(hwp.albums[0].tracks.length, 2);
  assert.match(hwp.albums[0].tracks[1].lyrics, /끝까지 보존/); assert.match(hwp.sources[0].text, /B10\nB11/);
  assert.ok(hwp.issues.some((i) => i.code === "EXTRACTION_REVIEW"));
  await assert.rejects(extractFileBlocks(await fixture("password-12345.hwp")), /암호화/);
  const pdf = await extractFiles([await fixture("text-korean.pdf")], "mv", "2026-09-07");
  assert.equal(pdf.albums[0].tracks[0].lyrics, "반복 구절\n반복 구절");
  const layout = await extractFiles([await fixture("pdf-two-albums-tables.pdf")], "album", "2026-09-07");
  assert.equal(layout.albums.length, 2);
  assert.equal(layout.albums[0].title, "첫 앨범"); assert.equal(layout.albums[0].tracks[0].title, "첫 곡");
  assert.equal(layout.albums[1].title, "둘째 앨범"); assert.equal(layout.albums[1].tracks[0].title, "둘째 곡");
  const scanned = await extractFiles([await fixture("scanned.pdf")], "mv", "2026-09-07");
  assert.ok(scanned.issues.some((i) => ["OCR_UNAVAILABLE", "OCR_LANGUAGE_MISSING", "EXTRACTION_REVIEW", "STRUCTURE_REQUIRED"].includes(i.code)));
});
test("MV repeated minimal artist-title headings become separate songs with original lyrics", () => {
  const result = structureExtractedFile(source, { format: "docx", warnings: [], blocks: ["가수 - 첫 곡", "첫 가사", "가수 - 둘째 곡", "둘째 가사"].map((text, i) => ({ text, location: `p${i}`, kind: "paragraph" })) }, "mv");
  assert.equal(result.albums[0].tracks.length, 2);
  assert.equal(result.albums[0].tracks[0].lyrics, "첫 가사");
});
test("segment translation keeps repeated English/Japanese/mixed originals and detects alignment drift", async () => {
  const data = createData("I love you\n한국어 I love you\n君が好き\nI love you");
  let requests = 0;
  const result = await translateReviewData(data, { translate: async (texts) => { requests += texts.length; return texts.map((t) => t.includes("君") ? "네가 좋아" : "나는 너를 사랑해"); } });
  assert.equal(requests, 2);
  const track = result.albums[0].tracks[0];
  assert.equal(track.translationSegments.length, 4);
  assert.equal(foreignLyricSpans("君が好き")[0].language, "ja");
  track.translationSegments.forEach((s) => { s.confirmed = true; });
  assert.equal(renderTrackLyrics(track), "I love you (번역 : 나는 너를 사랑해)\n한국어 I love you (번역 : 나는 너를 사랑해)\n君が好き (번역 : 네가 좋아)\nI love you (번역 : 나는 너를 사랑해)");
  track.lyrics = "변경 " + track.lyrics;
  assert.ok(validateReviewData(result).some((i) => i.code === "TRANSLATION_ALIGNMENT"));
});
test("existing inline translation not duplicated; separately supplied translation not guessed by line", async () => {
  let calls = 0;
  const inline = await translateReviewData(createData("I love you (번역 : 사랑해)"), { translate: async () => { calls++; return []; } });
  assert.equal(calls, 0); assert.equal(renderTrackLyrics(inline.albums[0].tracks[0]), "I love you (번역 : 사랑해)");
  const separate = createData("I love you\nI need you"); separate.albums[0].tracks[0].existingTranslation = "널 사랑하고 필요해";
  const result = await translateReviewData(separate, { translate: async () => { calls++; return []; } });
  assert.equal(calls, 0); assert.ok(validateReviewData(result).some((i) => i.code === "EXISTING_TRANSLATION_ALIGNMENT"));
});
test("translation failure is retriable without replacing admin data or adding placeholders", async () => {
  const data = createData("I love you");
  const failed = await translateReviewData(data, { translate: async () => null });
  assert.equal(failed.albums[0].tracks[0].translationSegments[0].translation, "");
  assert.ok(validateReviewData(failed).some((i) => i.code === "TRANSLATION_MISSING"));
  const retry = await translateReviewData(failed, { translate: async () => ["사랑해"] });
  assert.equal(retry.albums[0].tracks[0].translationSegments[0].translation, "사랑해");
});
test("URL canonicalization deduplicates and rejects internal/protocol/credentials/path tricks", async () => {
  assert.equal(canonicalReviewUrls(["http://melon.com/album/detail.htm?albumId=123&ref=x", "https://www.melon.com/album/detail.htm?albumId=123"]).duplicates.length, 1);
  for (const url of ["http://127.0.0.1/?albumId=123", "https://www.melon.com.evil.test/album/detail.htm?albumId=123", "file:///album/detail.htm?albumId=123", "https://user@www.melon.com/album/detail.htm?albumId=123", "https://www.melon.com/other?albumId=123"]) assert.throws(() => canonicalReviewUrls([url]));
  const fetcher = createReviewUrlFetcher(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
  await assert.rejects(fetcher("https://www.melon.com/album/detail.htm?albumId=123"), /공식 앨범/);
});
test("URL adapter directly reuses existing Melon and Genie parsers; partial failed song is visible", async () => {
  const melon = `<div class="section_info"><div class="song_name"><strong>앨범명</strong>앨범</div><a class="artist_name"><span>가수</span></a><div class="button d_album_like"></div></div><tr data-group-items="cd1"><input name="input_check" value="111" title="Mr. Moon 곡 선택"><span class="rank ">1</span><a href="javascript:melon.link.goSongDetail('111');">정보</a><a href="javascript:melon.play.playSong('1',111);">Mr. Moon</a></tr>`;
  const genie = `<div class="album-detail-infos"><h2 class="name">지니앨범</h2><span><img alt="아티스트"></span><span class="value">가수</span></div><!-- E. 앨범 기본 정보 --><tr class="list" songId="222"><td class="number">1</td><a class="title" title="지니곡">지니곡</a></tr>`;
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, "manual");
    const url = String(input);
    if (url.includes("song/detail")) return new Response("", { status: 503 });
    if (url.includes("songInfo")) return new Response('<div class="song-main-infos"><h2 class="name">지니곡</h2></div><pre id="pLyrics"><p>한국어 가사</p></pre>');
    return new Response(url.includes("melon") ? melon : genie);
  };
  const data = await extractUrls(["https://www.melon.com/album/detail.htm?albumId=123", "https://www.genie.co.kr/detail/albumInfo?axnm=321"], "2026-09-07", { fetcher });
  assert.equal(data.albums.length, 2);
  assert.equal(data.albums[0].tracks[0].lyricStatus, "extraction_failed"); assert.equal(data.albums[0].tracks[0].instrumentalConfirmed, false);
  assert.equal(data.albums[1].tracks[0].lyrics, "한국어 가사");
});
