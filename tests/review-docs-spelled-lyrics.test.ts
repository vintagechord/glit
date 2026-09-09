import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import { buildReviewDocsZip, type ReviewDocSubmissionBundle } from "../src/lib/admin/review-docs";
import { translateLyricsBatch } from "../src/lib/server-lyrics-translation";

test("an unchanged spelled-out name cannot prevent the review ZIP while sentence translations remain required", async () => {
  const source: ReviewDocSubmissionBundle = {
    submission: { title: "철자 가사 검증", artist_name: "검증 가수" },
    tracks: [{ track_no: 1, track_title: "철자 노래", lyrics: "J-E-O-N-G-S-I-K\nI will be okay\nWooh\nJ-E-O-N-G-S-I-K" }],
    files: [], events: [],
  };
  const requests: string[] = [];
  const translate = (lines: string[]) => translateLyricsBatch(lines, {
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.openai.com") return Response.json({}, { status: 503 });
      const lyric = url.hostname === "translate.googleapis.com" ? url.searchParams.get("q")! : decodeURIComponent(url.pathname.split("/").at(-1)!);
      requests.push(lyric);
      const translation = lyric === "I will be okay" ? "나는 괜찮을 거야" : lyric;
      return url.hostname === "translate.googleapis.com" ? Response.json([[[translation]]]) : Response.json({ translation });
    },
  });
  const zip = new PizZip(await buildReviewDocsZip([source], { translate }), { checkCRC32: true });
  const documents = Object.values(zip.files).filter((file) => !file.dir);
  assert.equal(documents.length, 8);
  for (const doc of documents.filter((file) => /\/(심의폼_|앨범정보_|가사전체파일_|01_)/.test(file.name))) {
    const text = new PizZip(doc.asNodeBuffer()).file("word/document.xml")!.asText().replace(/<[^>]+>/g, "");
    assert.equal((text.match(/J-E-O-N-G-S-I-K \(번역 : 제이 이 오 엔 지 에스 아이 케이\)/g) ?? []).length, 2, doc.name);
    assert.match(text, /I will be okay \(번역 : 나는 괜찮을 거야\)/, doc.name);
    assert.match(text, /Wooh/, doc.name);
  }
  assert.ok(!requests.includes("Wooh"));
});

test("spelled lyrics prefer an available semantic translation before the letter-name fallback", async () => {
  const result = await translateLyricsBatch(["L-O-V-E"], {
    fetchImpl: async (input) => new URL(String(input)).hostname === "api.openai.com"
      ? Response.json({}, { status: 503 }) : Response.json([[["사랑"]]]),
  });
  assert.deepEqual(result, ["사랑"]);
});
