import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import { buildReviewDocsZip, getReviewDocsErrorPayload, type ReviewDocSubmissionBundle } from "../src/lib/admin/review-docs";

const fixture = (): ReviewDocSubmissionBundle => ({
  submission: {
    id: "released-album", type: "ALBUM", is_oneclick: true,
    melon_url: "https://www.genie.co.kr/detail/albumInfo?axnm=123",
    title: "테스트 앨범", artist_name: "테스트 가수", release_date: "2026-09-01",
    genre: "락발라드, 인디음악", distributor: "유통사", production_company: "실제 제작사",
  },
  tracks: [{ track_no: 1, track_title: "노래", composer: "작곡가", lyricist: "작사가", arranger: "편곡가", lyrics: "I love you\n우리 함께\nI love you\n君を愛してる" }],
  files: [], events: [],
});

const texts = (buffer: Buffer) => Object.values(new PizZip(buffer).files)
  .filter((file) => !file.dir)
  .map((file) => ({ name: file.name, text: new PizZip(file.asNodeBuffer()).file("word/document.xml")!.asText().replace(/<[^>]*>/g, "") }));

test("complete saved URL submissions receive inline translations in every lyric document without refetching", async () => {
  const input = fixture();
  const before = structuredClone(input);
  let calls = 0;
  const documents = texts(await buildReviewDocsZip([input], {
    fetcher: async () => { throw new Error("complete saved source must not be fetched again"); },
    translate: async (segments) => {
      calls += 1;
      assert.deepEqual(segments, ["I love you", "君を愛してる"]);
      return ["나는 너를 사랑해", "너를 사랑해"];
    },
  }));
  assert.equal(calls, 1);
  assert.deepEqual(input, before, "download must not mutate saved source data");
  assert.equal(documents.length, 8);
  assert.ok(documents.every((doc) => doc.name.endsWith(".docx")));
  const lyricDocuments = documents.filter((doc) => /\/(심의폼_|앨범정보_|가사전체파일_|01_)/.test(doc.name));
  assert.equal(lyricDocuments.length, 4);
  for (const doc of lyricDocuments) {
    assert.equal((doc.text.match(/I love you \(번역 : 나는 너를 사랑해\)/g) ?? []).length, 2, doc.name);
    assert.match(doc.text, /君を愛してる \(번역 : 너를 사랑해\)/, doc.name);
    assert.match(doc.text, /우리 함께/, doc.name);
  }
});

test("a partial translation fails the ZIP instead of delivering untranslated lyrics", async () => {
  await assert.rejects(buildReviewDocsZip([fixture()], { translate: async () => ["나는 너를 사랑해", ""] }), (error) => {
    const payload = getReviewDocsErrorPayload(error);
    assert.equal(payload.status, 502);
    assert.equal("code" in payload.body ? payload.body.code : undefined, "REVIEW_TRANSLATION_FAILED");
    return true;
  });
});

test("latest station rules preserve primary genre, title marks, company and three WBS songs", async () => {
  const input = fixture();
  input.submission.is_oneclick = false;
  input.tracks = Array.from({ length: 4 }, (_, index) => ({ track_no: index + 1, track_title: `곡${index + 1}`, is_title: true, lyrics: "한글 가사" }));
  const documents = texts(await buildReviewDocsZip([input]));
  const request = documents.find((doc) => doc.name.includes("가요심의요청서_"))!.text;
  assert.match(request, /락발라드■/);
  assert.doesNotMatch(request, /(?:^|\s)(?:락|발라드)■/);
  assert.doesNotMatch(request, /\(타이틀\)/);
  const wbs = documents.find((doc) => doc.name.includes("WBS신청서"))!.text;
  assert.match(wbs, /곡1, 곡2, 곡3/);
  assert.doesNotMatch(wbs, /곡4/);
  assert.match(wbs, /실제 제작사/);
  assert.match(documents.find((doc) => doc.name.includes("심의폼_"))!.text, /빈티지코드/);
  assert.match(documents.find((doc) => doc.name.includes("앨범정보_"))!.text, /실제 제작사/);
});

test("source genre order determines the single checked genre", async () => {
  for (const [genre, expected] of [["R&B, 댄스", "R&amp;B■"], ["모던락, 발라드", "모던락■"], ["발라드, 인디음악", "발라드■"]]) {
    const input = fixture(); input.submission.is_oneclick = false; input.submission.genre = genre; input.tracks[0].lyrics = "한글 가사";
    const request = texts(await buildReviewDocsZip([input])).find((doc) => doc.name.includes("가요심의요청서_"))!.text;
    assert.ok(request.includes(expected), genre);
  }
});
