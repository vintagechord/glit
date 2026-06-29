import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import PizZip from "pizzip";

const outputDir = path.join(process.cwd(), "templates", "review-docs");

const escapeXml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const paragraph = (text) => {
  const lines = text.split("\n");
  const body = lines
    .map((line, index) => {
      const breakTag = index === 0 ? "" : "<w:br/>";
      return `${breakTag}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
    })
    .join("");
  return `<w:p><w:r>${body}</w:r></w:p>`;
};

const documentXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map(paragraph).join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const makeDocx = (paragraphs) => {
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
  zip.folder("word").file("document.xml", documentXml(paragraphs));
  zip.folder("word").file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
  </w:style>
</w:styles>`,
  );
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
};

const templates = {
  "song-review-request.docx": [
    "음원 심의 신청서",
    "생성일: {generated_at}",
    "신청 ID: {submission_id}",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "발매일: {release_date}",
    "장르: {genre}",
    "유통사: {distributor}",
    "제작사: {production_company}",
    "담당자: {contact_name}",
    "연락처: {contact_phone}",
    "이메일: {contact_email}",
    "수록곡",
    "{#tracks}",
    "{track_no}. {track_title} {title_marker}",
    "작곡: {composer} / 작사: {lyricist} / 편곡: {arranger}",
    "방송 선택: {broadcast_selected_label}",
    "{/tracks}",
  ],
  "review-form.docx": [
    "{document_title}",
    "문서 구분: {document_kind}",
    "생성일: {generated_at}",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "발매일: {release_date}",
    "장르: {genre}",
    "기획사: {planning_company}",
    "제작사: {production_company}",
    "소속사: {agency_company}",
    "레이블: {label_company}",
    "유통사: {distributor}",
    "담당자: {contact_name}",
    "연락처: {contact_phone}",
    "이메일: {contact_email}",
    "트랙 정보",
    "{#tracks}",
    "{track_no}. {track_title}",
    "피처링: {featuring}",
    "작곡: {composer}",
    "작사: {lyricist}",
    "편곡: {arranger}",
    "비고: {notes}",
    "{/tracks}",
  ],
  "lyrics-all.docx": [
    "전체 가사",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "{#tracks}",
    "{track_no}. {track_title}",
    "가사",
    "{lyrics}",
    "번역 가사",
    "{translated_lyrics}",
    "{/tracks}",
  ],
  "lyrics-track.docx": [
    "트랙별 가사",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "트랙: {track_no}. {track_title}",
    "피처링: {featuring}",
    "작곡: {composer}",
    "작사: {lyricist}",
    "편곡: {arranger}",
    "타이틀 여부: {is_title_label}",
    "방송 선택: {broadcast_selected_label}",
    "가사",
    "{lyrics}",
    "번역 가사",
    "{translated_lyrics}",
    "비고",
    "{notes}",
  ],
  "tbs-integrated.docx": [
    "{station_name} 통합 신청서",
    "생성일: {generated_at}",
    "앨범 수: {album_count}",
    "트랙 수: {track_count}",
    "{#submissions}",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "발매일: {release_date}",
    "기획/제작: {planning_company} / {production_company}",
    "{/submissions}",
    "트랙 목록",
    "{#tracks}",
    "{album_title} - {track_no}. {track_title}",
    "{/tracks}",
  ],
  "wbs-integrated.docx": [
    "{station_name} 통합 신청서",
    "생성일: {generated_at}",
    "앨범 수: {album_count}",
    "트랙 수: {track_count}",
    "{#submissions}",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "담당자: {contact_name} / {contact_phone}",
    "{/submissions}",
    "트랙 목록",
    "{#tracks}",
    "{album_title} - {track_no}. {track_title}",
    "{/tracks}",
  ],
  "pbc-integrated.docx": [
    "{station_name} 통합 신청서",
    "생성일: {generated_at}",
    "앨범 수: {album_count}",
    "트랙 수: {track_count}",
    "{#submissions}",
    "앨범명: {album_title}",
    "아티스트: {artist_name}",
    "유통사: {distributor}",
    "제작사: {production_company}",
    "{/submissions}",
    "트랙 목록",
    "{#tracks}",
    "{album_title} - {track_no}. {track_title}",
    "{/tracks}",
  ],
};

mkdirSync(outputDir, { recursive: true });

for (const [filename, paragraphs] of Object.entries(templates)) {
  writeFileSync(path.join(outputDir, filename), makeDocx(paragraphs));
}

console.log(`Generated ${Object.keys(templates).length} review doc templates.`);
