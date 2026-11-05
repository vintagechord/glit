import PizZip from 'pizzip';

// 통합신청서 합치기: TBS, WBS and PBC take one application listing many
// albums. The desk (and the web) write one integrated form per album; this
// joins several generated forms of the same station into one, keeping the
// first file's page, header rows and cell formatting and appending every
// album row in upload order. Album rows are copied as they are, so values an
// administrator corrected in a file are kept.

export class IntegratedMergeError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'IntegratedMergeError'; this.status = status; }
}

export const MERGE_LIMITS = { files: 50, fileBytes: 2 * 1024 * 1024 };
export const MERGE_STATIONS = ['TBS', 'WBS', 'PBC'];

// The three table layouts. Files are matched by their table, not their name:
// desk versions before 2.11 wrote the TBS and PBC forms the other way round.
const LAYOUTS = {
  wbs: { label: 'WBS 원음방송 가요심의신청', headerRows: 1, rowsPerAlbum: 1, numbered: true, keyFrom: 2, detect: (h) => /순서/.test(h) && /심의신청곡/.test(h) },
  list: { label: '심의 음반 접수 목록 (가수명/타이틀명 · CD수량)', headerRows: 1, rowsPerAlbum: 1, numbered: false, keyFrom: 1, detect: (h) => /CD\s*수량/.test(h) || /가수명\s*\/\s*타이틀명/.test(h) },
  twoRow: { label: '음원심의신청서 (일자·가수·신청자/연락처·앨범명·타이틀)', headerRows: 2, rowsPerAlbum: 2, numbered: false, keyFrom: 1, detect: (h) => /앨범명\s*-\s*타이틀곡/.test(h) || (/신청자/.test(h) && /일자/.test(h) && /가수/.test(h)) },
};
// Which form each station takes (owner, 2026-11-06; desk and web templates agree).
const STATION_LAYOUT = { WBS: 'wbs', TBS: 'list', PBC: 'twoRow' };

const textOf = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const cellsOf = (row) => [...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
const normalize = (value) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

function readForm(file) {
  if (!file?.name || !/\.docx$/i.test(file.name)) throw new IntegratedMergeError(`${file?.name || '파일'}: 통합신청서 DOCX 파일만 합칠 수 있습니다.`);
  if (!file.body?.length || file.body.length > MERGE_LIMITS.fileBytes) throw new IntegratedMergeError(`${file.name}: 비어 있거나 2MB를 넘는 파일입니다.`);
  let zip, xml;
  try { zip = new PizZip(file.body); xml = zip.file('word/document.xml')?.asText(); }
  catch { throw new IntegratedMergeError(`${file.name}: Word 문서를 열지 못했습니다. 통합신청서 DOCX인지 확인하세요.`); }
  if (!xml) throw new IntegratedMergeError(`${file.name}: Word 문서 본문이 없습니다.`);
  const tables = xml.match(/<w:tbl>/g)?.length ?? 0;
  if (tables !== 1 || /<w:tbl>[\s\S]*<w:tbl>[\s\S]*<\/w:tbl>[\s\S]*<\/w:tbl>/.test(xml)) throw new IntegratedMergeError(`${file.name}: 표가 하나인 통합신청서만 합칠 수 있습니다.`);
  const start = xml.indexOf('<w:tbl>'), end = xml.indexOf('</w:tbl>', start);
  const table = xml.slice(start, end);
  const rows = [...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)];
  if (!rows.length) throw new IntegratedMergeError(`${file.name}: 표에 행이 없습니다.`);
  const firstRow = rows[0].index;
  const lastRow = rows.at(-1);
  const headerText = normalize(textOf(rows.slice(0, 2).map((m) => m[0]).join(' ')));
  const layoutKey = Object.keys(LAYOUTS).find((key) => LAYOUTS[key].detect(headerText));
  if (!layoutKey) throw new IntegratedMergeError(`${file.name}: TBS·WBS·PBC 통합신청서 표를 찾지 못했습니다.`);
  const layout = LAYOUTS[layoutKey];
  const header = rows.slice(0, layout.headerRows).map((m) => m[0]);
  const data = rows.slice(layout.headerRows).map((m) => m[0]);
  if (layout.rowsPerAlbum === 2 && data.length % 2) throw new IntegratedMergeError(`${file.name}: 앨범 행 구성이 맞지 않습니다(2행 1앨범). 표를 직접 수정했다면 원래 구성으로 되돌려 주세요.`);
  const albums = [];
  for (let i = 0; i < data.length; i += layout.rowsPerAlbum) {
    const group = data.slice(i, i + layout.rowsPerAlbum);
    const cellTexts = group.flatMap((row) => cellsOf(row).map((cell) => normalize(textOf(cell))));
    if (!cellTexts.some(Boolean)) continue;
    // Dates and 순서 differ between exports of the same album.
    albums.push({ rows: group, key: cellTexts.slice(layout.keyFrom).join('|') });
  }
  return {
    name: file.name, zip, xml, layoutKey, headerKey: normalize(textOf(header.join(''))), albums,
    before: xml.slice(0, start + firstRow), header, after: xml.slice(start + lastRow.index + lastRow[0].length),
  };
}

function setFirstCellText(row, text) {
  return row.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/, (cell) => {
    let placed = false;
    const replaced = cell.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, (_, open, close) => {
      if (placed) return `${open}${close}`;
      placed = true;
      return `<w:t xml:space="preserve">${text}${close}`;
    });
    return placed ? replaced : replaced.replace(/<\/w:p>/, `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`);
  });
}

/**
 * @param {{station: string, files: Array<{name: string, body: Buffer}>}} input
 * @returns {{buffer: Buffer, filename: string, albums: number, files: number, duplicates: string[], layout: string, warnings: string[]}}
 */
export function mergeIntegratedForms({ station, files }) {
  if (!MERGE_STATIONS.includes(station)) throw new IntegratedMergeError('방송사(TBS·WBS·PBC)를 선택하세요.');
  if (!Array.isArray(files) || files.length < 2) throw new IntegratedMergeError('합칠 통합신청서를 2개 이상 선택하세요.');
  if (files.length > MERGE_LIMITS.files) throw new IntegratedMergeError(`한 번에 ${MERGE_LIMITS.files}개까지 합칠 수 있습니다.`);
  const forms = files.map(readForm);
  const base = forms[0];
  if (station === 'WBS' && base.layoutKey !== 'wbs') throw new IntegratedMergeError(`${base.name}: WBS 통합신청서가 아닙니다. 방송사 선택과 파일을 확인하세요.`);
  if (station !== 'WBS' && base.layoutKey === 'wbs') throw new IntegratedMergeError(`${base.name}: WBS 통합신청서입니다. 방송사를 WBS로 선택하세요.`);
  const mismatch = forms.find((form) => form.layoutKey !== base.layoutKey || form.headerKey !== base.headerKey);
  if (mismatch) throw new IntegratedMergeError(`${mismatch.name}: 다른 양식의 통합신청서입니다. 같은 방송사·같은 양식의 파일만 합칠 수 있습니다.`);

  const warnings = [];
  if (STATION_LAYOUT[station] !== base.layoutKey) {
    warnings.push(`${station}는 「${LAYOUTS[STATION_LAYOUT[station]].label}」 양식인데, 올린 파일은 「${LAYOUTS[base.layoutKey].label}」 표입니다. 이전 버전에서 만든 파일이거나 방송사를 잘못 고른 것일 수 있으니 확인하세요.`);
  }
  const seen = new Map();
  const duplicates = [];
  const rows = [];
  for (const form of forms) {
    if (!form.albums.length) warnings.push(`${form.name}: 앨범 행이 없어 건너뛰었습니다.`);
    for (const album of form.albums) {
      if (seen.has(album.key)) { duplicates.push(`${form.name} (${seen.get(album.key)}와 같은 앨범)`); continue; }
      seen.set(album.key, form.name);
      rows.push(album.rows);
    }
  }
  if (!rows.length) throw new IntegratedMergeError('합칠 앨범 행이 없습니다. 생성된 통합신청서를 선택했는지 확인하세요.');
  const layout = LAYOUTS[base.layoutKey];
  const body = rows.map((group, index) => (layout.numbered ? [setFirstCellText(group[0], String(index + 1)), ...group.slice(1)] : group).join('')).join('');
  base.zip.file('word/document.xml', `${base.before}${base.header.join('')}${body}${base.after}`);
  return {
    buffer: base.zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    filename: `${station}신청서_통합_${rows.length}건.docx`,
    albums: rows.length, files: forms.length, duplicates, layout: layout.label, warnings,
  };
}
