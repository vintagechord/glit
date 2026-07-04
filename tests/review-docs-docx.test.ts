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
      rowHeights: rows.map(
        (row) => row[0].match(/<trHeight[^>]*val="(\d+)"/)?.[1] ?? "",
      ),
      isCentered: /<jc[^>]*val="center"/.test(tableXml),
      hasFixedLayout: /<tblLayout[^>]*type="fixed"/.test(tableXml),
      hasCantSplitRows: /<cantSplit/.test(tableXml),
      hasShading: /<shd/.test(tableXml),
    };
  });

test("admin selected submission review docs zip uses example-like docx packaging and tables", async () => {
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
  fileNames.forEach((name) => {
    const buffer = outerZip.file(name)?.asNodeBuffer() ?? Buffer.alloc(0);
    const docx = new PizZip(buffer);
    assert.ok(docx.file("word/settings.xml"), `${name} includes word/settings.xml`);
    assert.ok(docx.file("word/fontTable.xml"), `${name} includes word/fontTable.xml`);
    assert.ok(docx.file("word/theme/theme1.xml"), `${name} includes word/theme/theme1.xml`);
    const xml = getDocXml(buffer);
    assert.match(xml, /맑은 고딕/, `${name} uses fixed Korean font`);
    assert.doesNotMatch(xml, /Malgun Gothic/, `${name} does not mix font names`);
  });

  const reviewFormName = fileNames.find((name) => name.includes("/심의폼_"));
  const albumInfoName = fileNames.find((name) => name.includes("/앨범정보_"));
  const songReviewRequestName = fileNames.find((name) =>
    name.includes("/가요심의요청서_"),
  );
  assert.ok(reviewFormName);
  assert.ok(albumInfoName);
  assert.ok(songReviewRequestName);

  const reviewFormBuffer =
    outerZip.file(reviewFormName)?.asNodeBuffer() ?? Buffer.alloc(0);
  const reviewFormDocx = new PizZip(reviewFormBuffer);
  const reviewFormXml = getDocXml(reviewFormBuffer);
  const albumInfoXml = getDocXml(outerZip.file(albumInfoName)?.asNodeBuffer() ?? Buffer.alloc(0));
  const songReviewRequestXml = getDocXml(
    outerZip.file(songReviewRequestName)?.asNodeBuffer() ?? Buffer.alloc(0),
  );
  const tables = getTableSummaries(reviewFormXml);
  const requestTables = getTableSummaries(songReviewRequestXml);

  assert.ok(reviewFormDocx.file("word/settings.xml"));
  assert.ok(reviewFormDocx.file("word/fontTable.xml"));
  assert.ok(reviewFormDocx.file("word/theme/theme1.xml"));
  assert.ok(reviewFormDocx.file("word/_rels/document.xml.rels"));
  assert.match(
    reviewFormDocx.file("word/settings.xml")?.asText() ?? "",
    /characterSpacingControl[^>]*doNotCompress/,
  );
  assert.match(reviewFormDocx.file("word/fontTable.xml")?.asText() ?? "", /맑은 고딕/);
  assert.match(reviewFormDocx.file("word/theme/theme1.xml")?.asText() ?? "", /script="Hang" typeface="맑은 고딕"/);

  assert.equal(tables.length, 4);
  assert.deepEqual(tables[0], {
    width: "9249",
    grid: [2376, 6873],
    rowCount: 6,
    cellCounts: [1, 2, 2, 2, 2, 2],
    rowHeights: ["1690", "833", "831", "842", "841", "853"],
    isCentered: true,
    hasFixedLayout: true,
    hasCantSplitRows: true,
    hasShading: false,
  });
  assert.deepEqual(tables[1], {
    width: "4863",
    grid: [1242, 3621],
    rowCount: 3,
    cellCounts: [2, 2, 2],
    rowHeights: ["558", "558", "558"],
    isCentered: true,
    hasFixedLayout: true,
    hasCantSplitRows: true,
    hasShading: false,
  });
  assert.deepEqual(tables[2].grid, [1097, 1098, 6821]);
  assert.deepEqual(tables[2].cellCounts, [3, 2, 2, 2, 2, 1]);
  assert.equal(tables[2].hasFixedLayout, true);
  assert.deepEqual(requestTables[0].rowHeights, [
    "650",
    "650",
    "540",
    "540",
    "420",
    "520",
    "620",
    "620",
  ]);
  assert.equal(requestTables[0].isCentered, true);
  assert.equal(requestTables[0].hasFixedLayout, true);
  assert.equal((reviewFormXml.match(/<br[^>]*type="page"/g) ?? []).length, 2);
  assert.doesNotMatch(reviewFormXml, /<tblpPr/);
  assert.doesNotMatch(songReviewRequestXml, /<tblpPr/);

  assert.match(reviewFormXml, /vintagechord@daum\.net/);
  assert.match(reviewFormXml, /빈티지코드/);
  assert.match(reviewFormXml, /맑은 고딕/);
  assert.doesNotMatch(reviewFormXml, /Malgun Gothic/);
  assert.match(reviewFormXml, /별고양이/);
  assert.match(reviewFormXml, /바람결에 나부끼는 저 햇살은/);
  assert.doesNotMatch(reviewFormXml, /별고양이/);
  assert.match(albumInfoXml, /BA MUSIC/);
});
