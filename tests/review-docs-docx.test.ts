import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import PizZip from "pizzip";

import {
  buildReviewDocsZip,
  recordReviewDocsGeneratedEvents,
  REVIEW_DOC_TEMPLATE_FILES,
  ReviewDocsRenderError,
  ReviewDocsTemplateMissingError,
} from "../src/lib/admin/review-docs";

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

const templateSourceDir = path.join(
  process.cwd(),
  "templates",
  "review-docs",
);

const templateSourceFixture = () => [
  {
    submission: {
      id: "33333333-3333-4333-8333-333333333333",
      type: "ALBUM",
      title: "템플릿 검증 앨범",
      artist_name: "템플릿 검증 가수",
      release_date: "2026-08-15",
      production_company: "검증 제작사",
      distributor: "검증 유통사",
      genre: "발라드",
    },
    tracks: [
      {
        track_no: 1,
        track_title: "검증곡",
        lyricist: "작사가",
        composer: "작곡가",
        arranger: "편곡가",
        lyrics: "첫 줄\n둘째 줄",
        is_title: true,
      },
    ],
    files: [],
    events: [],
  },
];

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
  assert.equal(
    reviewFormXml.replaceAll("빈티지코드", "__COMPANY__"),
    albumInfoXml.replaceAll("BA MUSIC", "__COMPANY__"),
    "심의폼과 앨범정보는 회사명 외에 동일한 템플릿 결과여야 합니다.",
  );
});

test("review docs normalize artist, company, dates, filenames, lyrics, and instrumental tracks", async () => {
  const zipBuffer = await buildReviewDocsZip([
    {
      submission: {
        id: "22222222-2222-4222-8222-222222222222",
        type: "ALBUM",
        title: "앨범\u200B명\u0001",
        artist_name: "Stage",
        artist_name_kr: "한국명",
        artist_name_en: "English",
        release_date: "2026-99-99",
        production_company: "",
        guest_company: "Guest Company",
        genre: "Pop",
        distributor: "Distributor",
      },
      tracks: [
        {
          submission_id: "22222222-2222-4222-8222-222222222222",
          track_no: 1,
          track_title: "Voice\u2060 Song",
          performer: "Track Singer One",
          lyricist: "Writer",
          composer: "Composer",
          arranger: "Arranger",
          lyrics: "",
          is_title: false,
        },
        {
          submission_id: "22222222-2222-4222-8222-222222222222",
          track_no: 2,
          track_title: "Karaoke Version",
          performer: "Track Singer Two",
          lyricist: "Hidden Writer",
          composer: "Composer",
          lyrics: "original lyrics",
          is_title: false,
        },
        {
          submission_id: "22222222-2222-4222-8222-222222222222",
          track_no: 3,
          track_title: "No Vocal",
          lyricist: "",
          composer: "Composer",
          lyrics: "",
          is_title: false,
        },
        {
          submission_id: "22222222-2222-4222-8222-222222222222",
          track_no: 4,
          track_title: "Hello",
          lyricist: "Writer",
          composer: "Composer",
          lyrics: "Hello",
          translated_lyrics: "안녕",
          is_title: false,
        },
      ],
      files: [],
      events: [],
    },
  ]);

  const zip = new PizZip(zipBuffer);
  const fileNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  assert.equal(fileNames.length, 11);
  assert.ok(
    fileNames.every((name) => !/[\u0000-\u001F\u200B-\u200D\u2060\uFEFF]/.test(name)),
  );

  const xmlByName = new Map(
    fileNames.map((name) => [
      name,
      getDocXml(zip.file(name)?.asNodeBuffer() ?? Buffer.alloc(0)),
    ]),
  );
  const allXml = Array.from(xmlByName.values()).join("\n");
  assert.match(allXml, /Stage \/ 한국명 \/ English/);
  assert.match(allXml, /Track Singer One/);
  assert.match(allXml, /Track Singer Two/);
  assert.match(allXml, /Guest Company/);
  assert.doesNotMatch(allXml, /2026\. 99\. 99\.|26\.99\.99|99\/99/);
  assert.doesNotMatch(allXml, /\u0001/);
  assert.doesNotMatch(allXml, /\(타이틀\)/);
  assert.match(allXml, /\(번역 : 안녕\)/);

  const voiceName = fileNames.find((name) => name.includes("/01_Voice Song.docx"));
  const karaokeName = fileNames.find((name) =>
    name.includes("/02_Karaoke Version.docx"),
  );
  const inferredInstrumentalName = fileNames.find((name) =>
    name.includes("/03_No Vocal.docx"),
  );
  assert.ok(voiceName);
  assert.ok(karaokeName);
  assert.ok(inferredInstrumentalName);

  const voiceXml = xmlByName.get(voiceName) ?? "";
  const karaokeXml = xmlByName.get(karaokeName) ?? "";
  const inferredInstrumentalXml = xmlByName.get(inferredInstrumentalName) ?? "";
  assert.match(voiceXml, /Writer/);
  assert.doesNotMatch(voiceXml, /가사 없음 \/ Instrumental/);
  assert.match(karaokeXml, /가사 없음 \/ Instrumental/);
  assert.doesNotMatch(karaokeXml, /Hidden Writer/);
  assert.match(inferredInstrumentalXml, /No Vocal \(Inst\.\)/);
  assert.match(inferredInstrumentalXml, /가사 없음 \/ Instrumental/);
});

test("integrated templates repeat one preserved table row per selected album", async () => {
  const first = templateSourceFixture()[0];
  const second = {
    ...first,
    submission: {
      ...first.submission,
      id: "55555555-5555-4555-8555-555555555555",
      title: "두 번째 앨범",
      artist_name: "두 번째 가수",
      production_company: "두 번째 제작사",
    },
    tracks: [
      {
        ...first.tracks[0],
        track_title: "두 번째 타이틀곡",
      },
    ],
  };
  const zip = new PizZip(await buildReviewDocsZip([first, second]));
  const fileNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  assert.equal(fileNames.length, 13);

  const expectedColumns = new Map([
    ["TBS신청서_통합.docx", 6],
    ["WBS신청서_통합.docx", 9],
    ["PBC신청서_통합.docx", 7],
  ]);
  for (const [filename, cellCount] of expectedColumns) {
    const archiveName = `통합신청서/${filename}`;
    const xml = getDocXml(zip.file(archiveName)?.asNodeBuffer() ?? Buffer.alloc(0));
    const tables = getTableSummaries(xml);
    assert.equal(tables.length, 1, filename);
    assert.equal(tables[0].rowCount, 3, filename);
    assert.deepEqual(tables[0].cellCounts, [cellCount, cellCount, cellCount]);
    assert.equal(tables[0].hasFixedLayout, true);
    assert.equal(tables[0].hasCantSplitRows, true);
    assert.match(xml, /검증 제작사/);
    assert.match(xml, /두 번째 제작사/);
    assert.doesNotMatch(xml, /\{[#/]?albums\}/);
  }
});

test("review docs audit events use the authenticated administrator and deduplicate ids", async () => {
  let insertedRows: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "submission_events");
      return {
        async insert(rows: Array<Record<string, unknown>>) {
          insertedRows = rows;
          return { error: null };
        },
      };
    },
  };

  await recordReviewDocsGeneratedEvents({
    supabase: supabase as never,
    submissionIds: ["submission-1", "submission-1", "submission-2"],
    actorUserId: "admin-user",
    mode: "bulk",
  });

  assert.equal(insertedRows.length, 2);
  assert.deepEqual(
    insertedRows.map((row) => row.submission_id),
    ["submission-1", "submission-2"],
  );
  assert.ok(
    insertedRows.every(
      (row) =>
        row.actor_user_id === "admin-user" &&
        row.event_type === "REVIEW_DOCS_GENERATED" &&
        String(row.message).includes("선택 2건"),
    ),
  );
});

test("review docs render directly from the configured DOCX files", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "review-doc-templates-"));
  const templateDir = path.join(tempRoot, "review-docs");
  context.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  await cp(templateSourceDir, templateDir, { recursive: true });

  const filename = REVIEW_DOC_TEMPLATE_FILES.songReviewRequest;
  const filePath = path.join(templateDir, filename);
  const sourceZip = new PizZip(await readFile(filePath));
  const documentFile = sourceZip.file("word/document.xml");
  assert.ok(documentFile);
  sourceZip.file(
    "word/document.xml",
    documentFile
      .asText()
      .replace(
        "<w:sectPr>",
        '<w:p><w:r><w:t>TEMPLATE-SOURCE-CHANGE</w:t></w:r></w:p><w:sectPr>',
      ),
  );
  await writeFile(
    filePath,
    sourceZip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );

  const rendered = new PizZip(
    await buildReviewDocsZip(templateSourceFixture(), { templateDir }),
  );
  const requestName = Object.keys(rendered.files).find((name) =>
    name.includes("/가요심의요청서_"),
  );
  const reviewFormName = Object.keys(rendered.files).find((name) =>
    name.includes("/심의폼_"),
  );
  assert.ok(requestName);
  assert.ok(reviewFormName);
  assert.match(
    getDocXml(rendered.file(requestName)?.asNodeBuffer() ?? Buffer.alloc(0)),
    /TEMPLATE-SOURCE-CHANGE/,
  );
  assert.doesNotMatch(
    getDocXml(rendered.file(reviewFormName)?.asNodeBuffer() ?? Buffer.alloc(0)),
    /TEMPLATE-SOURCE-CHANGE/,
  );
});

test("review docs fail clearly when a template is missing or corrupt", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "review-doc-errors-"));
  const templateDir = path.join(tempRoot, "review-docs");
  context.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  await cp(templateSourceDir, templateDir, { recursive: true });

  const missingFilename = REVIEW_DOC_TEMPLATE_FILES.lyricsTrack;
  await rm(path.join(templateDir, missingFilename));
  await assert.rejects(
    () => buildReviewDocsZip(templateSourceFixture(), { templateDir }),
    (error) =>
      error instanceof ReviewDocsTemplateMissingError &&
      error.missing.includes(missingFilename),
  );

  await cp(
    path.join(templateSourceDir, missingFilename),
    path.join(templateDir, missingFilename),
  );
  const corruptFilename = REVIEW_DOC_TEMPLATE_FILES.reviewForm;
  await writeFile(path.join(templateDir, corruptFilename), "not-a-docx");
  await assert.rejects(
    () => buildReviewDocsZip(templateSourceFixture(), { templateDir }),
    (error) =>
      error instanceof ReviewDocsRenderError &&
      error.message.includes(corruptFilename),
  );

  await cp(
    path.join(templateSourceDir, corruptFilename),
    path.join(templateDir, corruptFilename),
  );
  const invalidContractFilename = REVIEW_DOC_TEMPLATE_FILES.lyricsAll;
  const invalidContractPath = path.join(templateDir, invalidContractFilename);
  const invalidContractZip = new PizZip(await readFile(invalidContractPath));
  const invalidContractDocument = invalidContractZip.file("word/document.xml");
  assert.ok(invalidContractDocument);
  invalidContractZip.file(
    "word/document.xml",
    invalidContractDocument
      .asText()
      .replace("{#tracks}", "")
      .replace("{/tracks}", ""),
  );
  await writeFile(
    invalidContractPath,
    invalidContractZip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );
  await assert.rejects(
    () => buildReviewDocsZip(templateSourceFixture(), { templateDir }),
    (error) =>
      error instanceof ReviewDocsRenderError &&
      error.message.includes(invalidContractFilename) &&
      error.message.includes("필수 placeholder"),
  );
});
