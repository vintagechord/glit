import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";

import {
  buildMvLyricsDocument,
  ReviewDocsInputError,
  ReviewDocsUnsupportedTypeError,
} from "../src/lib/admin/review-docs";

const visible = (buffer: Buffer) =>
  new PizZip(buffer).file("word/document.xml")!.asText().replace(/<[^>]*>/g, "");

const mvSubmission = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000031",
  type: "MV_DISTRIBUTION",
  title: "뮤직비디오 제목",
  artist_name: "검증 가수",
  artist_name_kr: "검증 가수 공식",
  mv_song_title: "검증곡",
  mv_song_title_kr: "검증곡",
  mv_song_title_official: "검증곡 (Verify Song)",
  mv_lyrics: "오늘도 너를 기다려\nI miss you\n\n\n\n다시 만나",
  korean_lyrics_translation: null,
  ...overrides,
});

test("an MV application's typed lyrics become one 영등위 lyric Word file", async () => {
  const translated: string[][] = [];
  const document = await buildMvLyricsDocument(mvSubmission(), {
    translate: async (segments) => {
      translated.push(segments);
      return segments.map(() => "보고 싶어");
    },
  });
  assert.equal(document.filename, "가사_검증 가수_검증곡 (Verify Song).docx");
  const text = visible(document.buffer);
  assert.match(text, /검증 가수 - 검증곡 \(Verify Song\)/);
  assert.match(text, /오늘도 너를 기다려/);
  // Foreign lines get the same automatic translation as the album documents.
  assert.match(text, /I miss you \(번역 : 보고 싶어\)/);
  assert.deepEqual(translated, [["I miss you"]]);
});

test("lyrics that already carry a translation are not translated again", async () => {
  const document = await buildMvLyricsDocument(
    mvSubmission({ mv_lyrics: "I miss you (번역 : 보고 싶어)\n다시 만나" }),
    { translate: async () => assert.fail("no foreign line is left untranslated") },
  );
  assert.match(visible(document.buffer), /I miss you \(번역 : 보고 싶어\)/);
});

test("a no-lyrics note is printed as such instead of being translated", async () => {
  const document = await buildMvLyricsDocument(mvSubmission({ mv_lyrics: "Instrumental" }), {
    translate: async () => assert.fail("placeholders are not foreign lyrics"),
  });
  assert.match(visible(document.buffer), /가사 없음 \/ Instrumental/);
});

test("the MV lyric file needs typed lyrics and an MV submission", async () => {
  await assert.rejects(
    () => buildMvLyricsDocument(mvSubmission({ mv_lyrics: "  " })),
    (error) => error instanceof ReviewDocsInputError && /가사가 없습니다/.test(error.message),
  );
  await assert.rejects(
    () => buildMvLyricsDocument(mvSubmission({ type: "ALBUM" })),
    ReviewDocsUnsupportedTypeError,
  );
});

test("titles fall back like the review desk when the official title is missing", async () => {
  const document = await buildMvLyricsDocument(
    mvSubmission({ artist_name: "", mv_song_title_official: "", mv_song_title: "", mv_lyrics: "다시 만나" }),
  );
  assert.equal(document.filename, "가사_검증 가수 공식_검증곡.docx");
});
