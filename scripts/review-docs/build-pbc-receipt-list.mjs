// Writes the PBC integrated form 「심의 음반 접수 목록」 into the given DOCX
// templates, replacing only word/document.xml (styles, theme and settings stay).
// Owner 2026-11-15: PBC takes this landscape six-column list, TBS takes
// 「음원심의신청서」. Sizes come from the attached PBC신청서_예시.hwp:
// landscape A4, columns 6692/28200/6126/14333/14666/10421 HWPUNIT scaled to the
// printable width, title 13pt bold, header 12pt bold without shading, values 10pt,
// thin single borders, header row 2403 and value rows 2639 HWPUNIT high.
// Idempotent:
//   node scripts/review-docs/build-pbc-receipt-list.mjs templates/review-docs/pbc-integrated.docx tools/onside-desk/templates/pbc-integrated.docx
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../package.json', import.meta.url));
const PizZip = require('pizzip');

const PAGE = { width: 16838, height: 11906, top: 1100, right: 700, bottom: 700, left: 700 };
const HWP_COLUMNS = [6692, 28200, 6126, 14333, 14666, 10421];
const HWP_TO_TWIP = 1 / 5;
const HEADER_HEIGHT = Math.round(2403 * HWP_TO_TWIP);
const VALUE_HEIGHT = Math.round(2639 * HWP_TO_TWIP);

export function pbcColumnWidths() {
  const printable = PAGE.width - PAGE.left - PAGE.right;
  const total = HWP_COLUMNS.reduce((sum, width) => sum + width, 0);
  const widths = HWP_COLUMNS.map((width) => Math.floor((width / total) * printable));
  widths[1] += printable - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

const FONT = '<w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/>';
const run = (text, size, bold) => `<w:r><w:rPr>${FONT}${bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const BORDER = 'w:val="single" w:sz="4" w:space="0" w:color="000000"';

function cell(width, text, { header = false } = {}) {
  const flow = header ? '' : '<w:keepNext w:val="0"/><w:keepLines w:val="0"/>';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr>${flow}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${run(text, header ? 24 : 20, header)}</w:p></w:tc>`;
}

export function pbcReceiptListXml() {
  const widths = pbcColumnWidths();
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const header = ['일자', '가수명/타이틀명', 'CD수량', '기획사', '연락처', '비고(발매예정일)'];
  const values = ['{#albums}{today_md}', '{artist_display} / {title_track_title}', '1', '{company_actual}', '{manager_phone}', '{release_date_md}{/albums}'];
  const title = `<w:p><w:pPr><w:spacing w:before="0" w:after="360"/><w:jc w:val="center"/></w:pPr>${run('심의 음반 접수 목록', 26, true)}</w:p>`;
  const tblPr = `<w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top ${BORDER}/><w:left ${BORDER}/><w:bottom ${BORDER}/><w:right ${BORDER}/><w:insideH ${BORDER}/><w:insideV ${BORDER}/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
  // The header row repeats on every page; value rows may split across pages.
  const headerRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/><w:trHeight w:val="${HEADER_HEIGHT}" w:hRule="atLeast"/></w:trPr>${header.map((text, index) => cell(widths[index], text, { header: true })).join('')}</w:tr>`;
  const valueRow = `<w:tr><w:trPr><w:trHeight w:val="${VALUE_HEIGHT}" w:hRule="atLeast"/></w:trPr>${values.map((text, index) => cell(widths[index], text)).join('')}</w:tr>`;
  const section = `<w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}" w:orient="landscape"/><w:pgMar w:top="${PAGE.top}" w:right="${PAGE.right}" w:bottom="${PAGE.bottom}" w:left="${PAGE.left}" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="425"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${title}<w:tbl>${tblPr}${grid}${headerRow}${valueRow}</w:tbl>${section}</w:body></w:document>`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const xml = pbcReceiptListXml();
  for (const file of process.argv.slice(2)) {
    const zip = new PizZip(fs.readFileSync(file));
    if (zip.file('word/document.xml')?.asText() === xml) { console.log(`${file}: unchanged`); continue; }
    zip.file('word/document.xml', xml);
    fs.writeFileSync(file, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    console.log(`${file}: written`);
  }
}
