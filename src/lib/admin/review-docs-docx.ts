import PizZip from "pizzip";

type DocText = string | number | boolean | null | undefined;

type ParagraphOptions = {
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: number;
  spacingAfter?: number;
  spacingBefore?: number;
};

type CellOptions = ParagraphOptions & {
  colspan?: number;
  fill?: string;
  width?: number;
};

type TableCell = {
  text: DocText | DocText[];
  options?: CellOptions;
};

type TableOptions = {
  width?: number;
  columns?: number[];
};

type DocOptions = {
  landscape?: boolean;
  margin?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
};

type TrackDocData = Record<string, unknown> & {
  track_no: number;
  track_no_padded: string;
  track_title: string;
  track_title_for_docs: string;
  track_title_for_filename: string;
  composer: string;
  lyricist: string;
  lyricist_display: string;
  arranger: string;
  featuring: string;
  performer: string;
  notes: string;
  lyrics_display: string;
  is_title: boolean;
  is_instrumental: boolean;
};

type SubmissionDocData = Record<string, unknown> & {
  album_title: string;
  artist_name: string;
  genre: string;
  distributor: string;
  actual_company: string;
  review_company: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  today_long: string;
  today_year: string;
  today_mmdd: string;
  release_date_long: string;
  release_date_short: string;
  release_date_mmdd: string;
  production_date_long: string;
  production_date_short: string;
  track_count: number;
  track_count_label: string;
  genre_checkbox_line: string;
  title_track_title: string;
  integrated_song_titles: string;
  tracks: TrackDocData[];
};

const xmlEscape = (value: DocText) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const cleanLines = (value: DocText | DocText[]) => {
  const raw = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return raw.replace(/\r\n?/g, "\n").split("\n");
};

const run = (text: DocText, options?: ParagraphOptions) => {
  const size = options?.size ?? 11;
  return `<w:r><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>${options?.bold ? "<w:b/><w:bCs/>" : ""}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
};

const paragraph = (text: DocText, options?: ParagraphOptions) => {
  const align = options?.align ? `<w:jc w:val="${options.align}"/>` : "";
  const before =
    typeof options?.spacingBefore === "number"
      ? ` w:before="${options.spacingBefore}"`
      : "";
  const after =
    typeof options?.spacingAfter === "number"
      ? ` w:after="${options.spacingAfter}"`
      : ' w:after="80"';
  return `<w:p><w:pPr>${align}<w:spacing${before}${after}/></w:pPr>${run(
    text,
    options,
  )}</w:p>`;
};

const multilineParagraphs = (text: DocText | DocText[], options?: ParagraphOptions) =>
  cleanLines(text)
    .map((line) => paragraph(line, options))
    .join("");

const cell = (text: DocText | DocText[], options?: CellOptions) => {
  const width = options?.width ? `<w:tcW w:w="${options.width}" w:type="dxa"/>` : "";
  const colspan = options?.colspan ? `<w:gridSpan w:val="${options.colspan}"/>` : "";
  const fill = options?.fill ? `<w:shd w:fill="${options.fill}"/>` : "";
  return `<w:tc><w:tcPr>${width}${colspan}<w:vAlign w:val="center"/>${fill}</w:tcPr>${multilineParagraphs(
    text,
    options,
  )}</w:tc>`;
};

const row = (cells: TableCell[], height?: number) => {
  const trPr = height ? `<w:trPr><w:trHeight w:val="${height}"/></w:trPr>` : "";
  return `<w:tr>${trPr}${cells
    .map((item) => cell(item.text, item.options))
    .join("")}</w:tr>`;
};

const table = (rows: TableCell[][], options?: TableOptions) => {
  const width = options?.width ?? 9300;
  const grid = options?.columns?.length
    ? `<w:tblGrid>${options.columns
        .map((col) => `<w:gridCol w:w="${col}"/>`)
        .join("")}</w:tblGrid>`
    : "";
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="6"/><w:insideV w:val="single" w:sz="6"/></w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${rows
    .map((cells) => row(cells))
    .join("")}</w:tbl>`;
};

const documentXml = (body: string[], options?: DocOptions) => {
  const landscape = options?.landscape === true;
  const pageSize = landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const margin = options?.margin ?? {};
  const pageMargin = `<w:pgMar w:top="${margin.top ?? 900}" w:right="${margin.right ?? 900}" w:bottom="${margin.bottom ?? 900}" w:left="${margin.left ?? 900}" w:header="720" w:footer="720" w:gutter="0"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join("\n")}
    <w:sectPr>${pageSize}${pageMargin}</w:sectPr>
  </w:body>
</w:document>`;
};

const makeDocx = (body: string[], options?: DocOptions) => {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word").file("document.xml", documentXml(body, options));
  zip.folder("word").file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
</w:styles>`,
  );
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
};

const headerCell = (text: DocText, colspan = 1): TableCell => ({
  text,
  options: {
    colspan,
    bold: true,
    align: "center",
    fill: "EDEDED",
    size: 10,
  },
});

const valueCell = (text: DocText | DocText[], colspan = 1, size = 10): TableCell => ({
  text,
  options: { colspan, align: "center", size },
});

const fieldRows = (items: Array<[DocText, DocText]>) =>
  items.map(([label, value]) => [headerCell(label), valueCell(value)]);

const isBlank = (value: DocText) => !String(value ?? "").trim();

const lyricText = (track: TrackDocData) =>
  isBlank(track.lyrics_display) ? "가사 없음 / Instrumental" : track.lyrics_display;

export function createSongReviewRequestDocx(data: SubmissionDocData) {
  const rows: TableCell[][] = [
    [
      headerCell("음반제목", 2),
      valueCell(data.album_title, 2),
      headerCell("발매일"),
      valueCell(data.release_date_long),
      headerCell("기획사(제작사)"),
      valueCell(data.review_company, 2),
    ],
    [
      headerCell("제작일", 2),
      valueCell(data.production_date_long, 2),
      headerCell("유통사"),
      valueCell(data.distributor),
      headerCell("담당자(연락처)"),
      valueCell([`${data.contact_name}(${data.contact_phone})`, data.contact_email], 2),
    ],
    [headerCell("음반장르", 2), valueCell(data.genre_checkbox_line, 7)],
    [
      headerCell("심의요청곡수", 2),
      valueCell(data.track_count_label, 2),
      headerCell("음반형태", 2),
      valueCell("디지털■  일반□  컴필□", 3),
    ],
    [
      valueCell(
        `(음반형태가 디지털앨범일 경우) 디지털음원  ${data.track_count} 곡은 CD로 유통하지 않고 온라인, 모바일을 통해 디지털로만 유통되고 있음을 증명합니다.`,
        9,
      ),
    ],
    [
      headerCell("트랙"),
      headerCell("곡명"),
      headerCell("곡장르"),
      headerCell("가수"),
      headerCell("피처링"),
      headerCell("편곡"),
      headerCell("작사"),
      headerCell("작곡"),
      headerCell("연주가(악기명)"),
    ],
    ...data.tracks.map((track) => [
      valueCell(track.track_no_padded),
      valueCell(track.track_title),
      valueCell(data.genre),
      valueCell(data.artist_name),
      valueCell(track.featuring),
      valueCell(track.arranger),
      valueCell(track.lyricist_display),
      valueCell(track.composer),
      valueCell(track.performer),
    ]),
  ];

  return makeDocx(
    [
      paragraph("- 가요 심의 요청 양식 -", {
        align: "center",
        bold: true,
        size: 14,
        spacingAfter: 120,
      }),
      paragraph(
        `접수일자 :  ${data.today_long}                                                                       음반접수용(KBS가요심의곡)`,
        { size: 10, spacingAfter: 140 },
      ),
      table(rows, { width: 15000 }),
      paragraph(""),
      paragraph(
        "※ 저작권법에서는 저작물(음반)에 대한 저작자(작곡자, 작사자)와 실연자(가수, 연주자, 지휘자)의 성명을 표시하도록 하고 있습니다.(저작권법 제12조, 제66조)",
        { size: 9 },
      ),
      paragraph(
        "음반에 대한 저작자와 실연자의 성명 또는 예명을 기재하지 않을 경우 이들의 성명표시권 침해가 되어 법적 분쟁이 발생될 수 있으니 번거로우시더라도 음반 심의 신청 시 작곡자, 작사자, 편곡자, 피쳐링, 가수와 곡연자주(연주악기명)의 성명 또는 예명을 필히 기재하여 주시기 바랍니다.",
        { size: 9 },
      ),
    ],
    {
      landscape: true,
      margin: { top: 400, right: 700, bottom: 400, left: 700 },
    },
  );
}

export function createReviewFormDocx(data: SubmissionDocData, title: string) {
  const body: string[] = [
    table([
      [{ text: data.album_title, options: { colspan: 2, bold: true, align: "center", size: 18 } }],
      ...fieldRows([
        ["가수명", data.artist_name],
        ["발매일", data.release_date_short],
        ["제작일", data.production_date_short],
        ["기획사", data.company_name as string],
        ["유통사", data.distributor],
      ]),
    ]),
    paragraph(""),
    table(
      fieldRows([
        ["담당자", data.contact_name],
        ["연락처", data.contact_phone],
        ["e-mail", data.contact_email],
      ]),
      { width: 5000 },
    ),
    paragraph(title, { bold: true, size: 12, spacingBefore: 220 }),
  ];

  data.tracks.forEach((track, index) => {
    if (index > 0) body.push(paragraph(""));
    body.push(
      table([
        [
          headerCell("트랙번호"),
          valueCell(track.track_no_padded),
          valueCell(track.track_title_for_docs, 2, 11),
        ],
        [headerCell("작사", 2), valueCell(track.lyricist_display, 2, 11)],
        [headerCell("작곡", 2), valueCell(track.composer, 2, 11)],
        [headerCell("편곡", 2), valueCell(track.arranger, 2, 11)],
        [headerCell("실연", 2), valueCell(track.performer, 2, 11)],
        [{ text: lyricText(track), options: { colspan: 4, size: 11 } }],
      ]),
    );
  });

  return makeDocx(body);
}

const lyricHeader = (data: SubmissionDocData, size: number) => [
  paragraph(`담당자 : ${data.contact_name}`, { size, spacingAfter: 20 }),
  paragraph(`연락처 : ${data.contact_phone}`, { size, spacingAfter: 160 }),
  paragraph(`${data.artist_name} - ${data.album_title}  (장르 : ${data.genre})`, {
    size,
    bold: true,
    spacingAfter: 160,
  }),
];

const creditLine = (track: TrackDocData) => {
  const parts = [];
  if (!track.is_instrumental && track.lyricist_display) parts.push(`작사: ${track.lyricist_display}`);
  if (track.composer) parts.push(`작곡: ${track.composer}`);
  if (track.arranger) parts.push(`편곡: ${track.arranger}`);
  return parts.length ? `(${parts.join("   ")})` : "";
};

export function createLyricsAllDocx(data: SubmissionDocData) {
  const body = lyricHeader(data, 11);
  data.tracks.forEach((track, index) => {
    if (index > 0) body.push(paragraph("", { spacingAfter: 80 }));
    body.push(
      paragraph(`${track.track_no_padded}. ${track.track_title_for_docs}`, {
        bold: true,
        size: 11,
        spacingAfter: 40,
      }),
    );
    const credits = creditLine(track);
    if (credits) body.push(paragraph(credits, { size: 10, spacingAfter: 60 }));
    body.push(...cleanLines(lyricText(track)).map((line) => paragraph(line, { size: 10, spacingAfter: 20 })));
  });
  return makeDocx(body, { margin: { top: 720, right: 900, bottom: 720, left: 900 } });
}

export function createLyricsTrackDocx(data: SubmissionDocData, track: TrackDocData) {
  const body = lyricHeader(data, 11);
  body.push(
    paragraph(`${track.track_no_padded}. ${track.track_title_for_docs}`, {
      bold: true,
      size: 11,
      spacingAfter: 60,
    }),
  );
  const credits = creditLine(track);
  if (credits) body.push(paragraph(credits, { size: 11, spacingAfter: 80 }));
  body.push(...cleanLines(lyricText(track)).map((line) => paragraph(line, { size: 11, spacingAfter: 40 })));
  return makeDocx(body);
}

export function createTbsIntegratedDocx(submissions: SubmissionDocData[]) {
  const rows: TableCell[][] = [
    [
      headerCell("일자"),
      headerCell("가수명 / 타이틀명"),
      headerCell("CD수량"),
      headerCell("기획사"),
      headerCell("연락처"),
      headerCell("비고(발매예정일)"),
    ],
    ...submissions.map((item) => [
      valueCell(item.today_mmdd),
      valueCell(`${item.artist_name} / ${item.title_track_title}`),
      valueCell("1"),
      valueCell(item.actual_company),
      valueCell(item.contact_phone),
      valueCell(item.release_date_mmdd),
    ]),
  ];
  return makeDocx(
    [
      paragraph("심의 음반 접수 목록", { align: "center", bold: true, size: 16 }),
      table(rows, { width: 9300 }),
    ],
    { margin: { top: 1100, right: 1200, bottom: 900, left: 1200 } },
  );
}

export function createWbsIntegratedDocx(submissions: SubmissionDocData[]) {
  const rows: TableCell[][] = [
    [
      headerCell("순서"),
      headerCell("신청일자"),
      headerCell("가수"),
      headerCell("제작사"),
      headerCell("연락처"),
      headerCell("심의신청곡"),
      headerCell("장르"),
      headerCell("음원 공개일자"),
      headerCell("신청자"),
    ],
    ...submissions.map((item, index) => [
      valueCell(index + 1),
      valueCell(item.today_mmdd),
      valueCell(item.artist_name),
      valueCell(item.actual_company),
      valueCell(item.contact_phone),
      valueCell(item.integrated_song_titles),
      valueCell(item.genre),
      valueCell(item.release_date_mmdd),
      valueCell(item.contact_name),
    ]),
  ];
  return makeDocx(
    [
      paragraph(`${submissions[0]?.today_year ?? ""}년 WBS 원음방송 가요심의신청`, {
        align: "center",
        bold: true,
        size: 15,
      }),
      paragraph("준비사항 : 앨범 1장(심의제출용), 가사집 1부", { size: 10 }),
      paragraph("가사집 내 필수기재사항 : 가수, 곡명, 장르, 타이틀곡, 영문가사는 번역본", {
        size: 10,
      }),
      paragraph(
        "※ 심의 신청 양식 빠짐 없이 기재 부탁드립니다. 심의받을 곡(최대3곡) 누락 시 트랙 1,2,3번으로 심의하겠습니다.",
        { size: 9 },
      ),
      table(rows, { width: 9800 }),
    ],
    { landscape: true, margin: { top: 700, right: 700, bottom: 700, left: 700 } },
  );
}

export function createPbcIntegratedDocx(submissions: SubmissionDocData[]) {
  const rows: TableCell[][] = [
    [
      headerCell("일자"),
      headerCell("가수"),
      headerCell("신청자"),
      headerCell("앨범명"),
      headerCell("타이틀곡명"),
      headerCell("회사명"),
      headerCell("연락처"),
    ],
    ...submissions.map((item) => [
      valueCell(item.today_mmdd),
      valueCell(item.artist_name),
      valueCell(item.contact_name),
      valueCell(item.album_title),
      valueCell(item.title_track_title),
      valueCell(item.actual_company),
      valueCell(item.contact_phone),
    ]),
  ];
  return makeDocx(
    [
      paragraph("음원심의신청서", { align: "center", bold: true, size: 16 }),
      table(rows, { width: 9300 }),
    ],
    { margin: { top: 1100, right: 1200, bottom: 900, left: 1200 } },
  );
}
