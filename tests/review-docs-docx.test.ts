import assert from "node:assert/strict";
import test from "node:test";

import PizZip from "pizzip";

import { buildReviewDocsZip } from "../src/lib/admin/review-docs";

const stripWordNamespaces = (xml: string) =>
  xml
    .replace(/(<\/?)([a-zA-Z0-9]+):/g, "$1")
    .replace(/\s[a-zA-Z0-9]+:/g, " ");

const getDocXml = (docx: Buffer) =>
  stripWordNamespaces(new PizZip(docx).file("word/document.xml")?.asText() ?? "");

const getTableSummaries = (xml: string) =>
  [...xml.matchAll(/<tbl[\s\S]*?<\/tbl>/g)].map((match) => {
    const tableXml = match[0];
    const rows = [...tableXml.matchAll(/<tr[\s\S]*?<\/tr>/g)];
    return {
      width: tableXml.match(/<tblW[^>]*w="(\d+)"/)?.[1] ?? "",
      grid: [...tableXml.matchAll(/<gridCol[^>]*w="(\d+)"/g)].map(
        (gridMatch) => Number(gridMatch[1]),
      ),
      rowCount: rows.length,
      cellCounts: rows.map((row) => [...row[0].matchAll(/<tc>/g)].length),
      hasShading: /<shd/.test(tableXml),
    };
  });

test("review docs zip uses docx-only files and example-like review form tables", async () => {
  const decomposedTitle = "별고양이".normalize("NFD");
  const decomposedLyric = "바람결에 나부끼는 저 햇살은".normalize("NFD");
  const zipBuffer = await buildReviewDocsZip([
    {
      submission: {
        id: "11111111-1111-4111-8111-111111111111",
        type: "ALBUM",
        title: decomposedTitle,
        artist_name: "더 포엠(The Poem)",
        release_date: "2026-07-21",
        production_date: "2026-07-21",
        genre: "발라드",
        distributor: "블렌딩",
        production_company: "BA MUSIC",
      },
      tracks: [
        {
          submission_id: "11111111-1111-4111-8111-111111111111",
          track_no: 1,
          track_title: decomposedTitle,
          is_title: true,
          lyricist: "더 포엠(The Poem)",
          composer: "더 포엠(The Poem)",
          arranger: "ANDRO",
          lyrics: `${decomposedLyric}\n내 어깨를 스쳐 가고`,
        },
        {
          submission_id: "11111111-1111-4111-8111-111111111111",
          track_no: 2,
          track_title: "별고양이 (Inst.)",
          is_title: false,
          lyricist: "더 포엠(The Poem)",
          composer: "더 포엠(The Poem)",
          arranger: "ANDRO",
          lyrics: "",
        },
      ],
      files: [],
      events: [],
    },
  ]);

  const outerZip = new PizZip(zipBuffer);
  const fileNames = Object.keys(outerZip.files).filter(
    (name) => !outerZip.files[name].dir,
  );
  assert.ok(fileNames.length > 0);
  assert.ok(fileNames.every((name) => name.endsWith(".docx")));
  assert.ok(fileNames.every((name) => !name.endsWith(".hwp")));

  const reviewFormName = fileNames.find((name) => name.includes("/심의폼_"));
  const albumInfoName = fileNames.find((name) => name.includes("/앨범정보_"));
  assert.ok(reviewFormName);
  assert.ok(albumInfoName);

  const reviewFormXml = getDocXml(outerZip.file(reviewFormName)?.asNodeBuffer() ?? Buffer.alloc(0));
  const albumInfoXml = getDocXml(outerZip.file(albumInfoName)?.asNodeBuffer() ?? Buffer.alloc(0));
  const tables = getTableSummaries(reviewFormXml);

  assert.equal(tables.length, 4);
  assert.deepEqual(tables[0], {
    width: "9249",
    grid: [2376, 6873],
    rowCount: 6,
    cellCounts: [1, 2, 2, 2, 2, 2],
    hasShading: false,
  });
  assert.deepEqual(tables[1], {
    width: "4863",
    grid: [1242, 3621],
    rowCount: 3,
    cellCounts: [2, 2, 2],
    hasShading: false,
  });
  assert.deepEqual(tables[2].grid, [1097, 1098, 6821]);
  assert.deepEqual(tables[2].cellCounts, [3, 2, 2, 2, 2, 1]);

  assert.match(reviewFormXml, /vintagechord@daum\.net/);
  assert.match(reviewFormXml, /빈티지코드/);
  assert.match(reviewFormXml, /별고양이/);
  assert.match(reviewFormXml, /바람결에 나부끼는 저 햇살은/);
  assert.doesNotMatch(reviewFormXml, /별고양이/);
  assert.match(albumInfoXml, /BA MUSIC/);
});
