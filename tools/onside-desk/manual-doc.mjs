import PizZip from 'pizzip';
import { readCompoundStreams } from './manual-ole.mjs';

// Read-only Word 97–2003 (.doc) reader for reference application forms.
// It reads the [MS-DOC] piece table and paragraph properties directly and
// keeps the form's table layout (cells and rows), which macOS textutil
// flattened into paragraphs: the 타이틀곡여부 cell and the closing guidance
// then ran into the last song's lyrics. Shared by the review desk and the
// web admin (src/lib/admin/legacy-word-doc.ts). Never executes content.
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/

export class LegacyWordError extends Error {
  constructor(code, message) { super(message); this.name = 'LegacyWordError'; this.code = code; this.status = 400; }
}

const MAX_CHARACTERS = 600_000;
const fail = (code, message) => { throw new LegacyWordError(code, message); };
const corrupt = () => fail('CORRUPT', 'Word 문서 구조가 손상되었습니다. Word에서 DOCX로 저장해 다시 올려주세요.');

// Bytes 0x80–0x9F of compressed (8-bit) pieces use Windows-1252 code points.
const cp1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function readPieces(table, fcClx, lcbClx) {
  if (!lcbClx || fcClx + lcbClx > table.length) return corrupt();
  let pos = fcClx;
  const end = fcClx + lcbClx;
  while (pos < end) {
    const clxt = table[pos];
    if (clxt === 1) {
      if (pos + 3 > end) return corrupt();
      pos += 3 + table.readUInt16LE(pos + 1);
      continue;
    }
    if (clxt !== 2 || pos + 5 > end) return corrupt();
    const lcb = table.readUInt32LE(pos + 1);
    const start = pos + 5;
    if (start + lcb > end || lcb < 16 || (lcb - 4) % 12) return corrupt();
    const count = (lcb - 4) / 12;
    const pieces = [];
    for (let index = 0; index < count; index++) {
      const cpStart = table.readUInt32LE(start + index * 4);
      const cpEnd = table.readUInt32LE(start + (index + 1) * 4);
      const raw = table.readUInt32LE(start + (count + 1) * 4 + index * 8 + 2);
      const compressed = (raw & 0x40000000) !== 0;
      const fcValue = raw & 0x3fffffff;
      if (cpEnd < cpStart) return corrupt();
      pieces.push({ cpStart, cpEnd, fc: compressed ? fcValue / 2 : fcValue, compressed });
    }
    return pieces;
  }
  return corrupt();
}

function sprmOperandSize(sprm, grpprl, operand) {
  switch (sprm >> 13) {
    case 0: case 1: return 1;
    case 2: case 4: case 5: return 2;
    case 3: return 4;
    case 7: return 3;
    default:
      if (operand >= grpprl.length) return grpprl.length;
      // sprmTDefTable stores a two-byte length; other variable sprms one byte.
      if (sprm === 0xd608) return operand + 2 <= grpprl.length ? grpprl.readUInt16LE(operand) + 1 : grpprl.length;
      return grpprl[operand] + 1;
  }
}

function paragraphProperties(grpprl) {
  let inTable = false, rowEnd = false;
  for (let pos = 0; pos + 2 <= grpprl.length;) {
    const sprm = grpprl.readUInt16LE(pos);
    const operand = pos + 2;
    const size = sprmOperandSize(sprm, grpprl, operand);
    if (operand + size > grpprl.length) break;
    if (sprm === 0x2416) inTable = grpprl[operand] !== 0; // sprmPFInTable
    else if (sprm === 0x2417) rowEnd = grpprl[operand] !== 0; // sprmPFTtp
    else if (sprm === 0x6649 && grpprl.readInt32LE(operand) > 0) inTable = true; // sprmPItap
    pos = operand + size;
  }
  return { inTable, rowEnd };
}

function readParagraphRuns(word, table, fcPlc, lcbPlc) {
  if (!lcbPlc) return [];
  if (fcPlc + lcbPlc > table.length || (lcbPlc - 4) % 8) return corrupt();
  const count = (lcbPlc - 4) / 8;
  const runs = [];
  for (let index = 0; index < count; index++) {
    const pn = table.readUInt32LE(fcPlc + (count + 1) * 4 + index * 4) & 0x3fffff;
    const page = pn * 512;
    if (page + 512 > word.length) return corrupt();
    const crun = word[page + 511];
    if (!crun || (crun + 1) * 4 + crun * 13 > 511) return corrupt();
    for (let run = 0; run < crun; run++) {
      const fcStart = word.readUInt32LE(page + run * 4);
      const fcEnd = word.readUInt32LE(page + (run + 1) * 4);
      const bOffset = word[page + (crun + 1) * 4 + run * 13];
      let properties = { inTable: false, rowEnd: false };
      if (bOffset) {
        const offset = page + bOffset * 2;
        if (offset >= page + 511) return corrupt();
        const cb = word[offset];
        const start = cb ? offset + 1 : offset + 2;
        const length = cb ? cb * 2 - 1 : word[offset + 1] * 2;
        if (start + length > page + 511 || length < 2) return corrupt();
        // GrpPrlAndIstd: a two-byte style index, then the property list.
        properties = paragraphProperties(word.subarray(start + 2, start + length));
      }
      runs.push({ fcStart, fcEnd, ...properties });
    }
  }
  return runs.sort((a, b) => a.fcStart - b.fcStart);
}

function findRun(runs, fc) {
  let low = 0, high = runs.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const run = runs[middle];
    if (fc < run.fcStart) high = middle - 1;
    else if (fc >= run.fcEnd) low = middle + 1;
    else return run;
  }
  return null;
}

/** Paragraphs ({kind:'paragraph',text}) and table rows ({kind:'row',cells}) of the main document, in reading order. */
export function readLegacyWordBlocks(body) {
  let streams;
  try { streams = readCompoundStreams(body); }
  catch (error) { return fail(error?.code ?? 'CORRUPT', error instanceof Error ? error.message : 'Word 문서를 읽지 못했습니다.'); }
  const word = streams.get('WordDocument')?.();
  if (!word || word.length < 512 || word.readUInt16LE(0) !== 0xa5ec) {
    return fail('FORMAT_MISMATCH', '실제 구형 Word DOC 파일이 아닙니다. DOCX로 저장 후 다시 올려주세요.');
  }
  const flags = word.readUInt16LE(0x0a);
  if (flags & 0x0100 || flags & 0x8000) return fail('ENCRYPTED', '암호화된 Word 문서는 읽을 수 없습니다. 암호를 해제한 뒤 올려주세요.');
  const table = streams.get(flags & 0x0200 ? '1Table' : '0Table')?.();
  if (!table) return corrupt();

  const csw = word.readUInt16LE(32);
  const longs = 34 + csw * 2;
  const cslw = word.readUInt16LE(longs);
  if (cslw < 4 || longs + 2 + cslw * 4 + 2 > word.length) return corrupt();
  const ccpText = word.readInt32LE(longs + 2 + 3 * 4);
  if (ccpText < 0) return corrupt();
  if (ccpText > MAX_CHARACTERS) return fail('TEXT_LIMIT', '문서 본문이 600,000자를 초과했습니다. 문서를 나누어 주세요.');
  const pairs = longs + 2 + cslw * 4;
  const pairCount = word.readUInt16LE(pairs);
  const pair = (index) => {
    if (index >= pairCount || pairs + 2 + index * 8 + 8 > word.length) return corrupt();
    const position = pairs + 2 + index * 8;
    return [word.readUInt32LE(position), word.readUInt32LE(position + 4)];
  };
  const [fcPlcfBtePapx, lcbPlcfBtePapx] = pair(13);
  const [fcClx, lcbClx] = pair(33);
  const pieces = readPieces(table, fcClx, lcbClx);
  const runs = readParagraphRuns(word, table, fcPlcfBtePapx, lcbPlcfBtePapx);

  const blocks = [];
  const fields = [];
  let text = '';
  let cell = [];
  let row = [];
  let previousMark = 0;
  const flushRow = () => {
    if (cell.length) { row.push(cell.join('\n')); cell = []; }
    if (row.length) blocks.push({ kind: 'row', cells: row.map((value) => value.trim()) });
    row = [];
  };
  const endParagraph = (mark, fc) => {
    const paragraph = text.replace(/\s+$/, '');
    text = '';
    const run = findRun(runs, fc);
    // Without paragraph properties a cell mark still ends a cell; an empty
    // one right after another cell mark is the row end.
    const inTable = run ? run.inTable : mark === 7;
    const rowEnd = run ? run.rowEnd : mark === 7 && previousMark === 7 && !paragraph;
    previousMark = mark;
    if (rowEnd) { flushRow(); return; }
    if (inTable) {
      cell.push(paragraph);
      if (mark === 7) { row.push(cell.join('\n')); cell = []; }
      return;
    }
    flushRow();
    blocks.push({ kind: 'paragraph', text: paragraph });
  };

  for (const piece of pieces) {
    const from = Math.max(0, piece.cpStart);
    const to = Math.min(ccpText, piece.cpEnd);
    for (let cp = from; cp < to; cp++) {
      const offset = piece.compressed ? piece.fc + (cp - piece.cpStart) : piece.fc + (cp - piece.cpStart) * 2;
      if (offset + (piece.compressed ? 1 : 2) > word.length) return corrupt();
      let code = piece.compressed ? word[offset] : word.readUInt16LE(offset);
      if (piece.compressed && cp1252[code]) code = cp1252[code];
      if (code === 0x13) { fields.push('code'); continue; }
      if (code === 0x14) { if (fields.length) fields[fields.length - 1] = 'result'; continue; }
      if (code === 0x15) { fields.pop(); continue; }
      if (code === 0x0d || code === 0x07 || code === 0x0c || code === 0x0e) { endParagraph(code, offset); continue; }
      if (fields.some((state) => state === 'code')) continue;
      if (code === 0x0b) text += '\n';
      else if (code === 0x09) text += '\t';
      else if (code === 0x1e) text += '-';
      else if (code === 0xa0 || code === 0x3000) text += ' ';
      else if (code >= 0x20 && code !== 0x1f) text += String.fromCharCode(code);
    }
  }
  if (text.trim()) endParagraph(0x0d, -1);
  flushRow();
  if (!blocks.some((block) => block.kind === 'paragraph' ? block.text.trim() : block.cells.some((value) => value))) {
    return fail('NO_TEXT', '읽을 수 있는 본문이 없습니다. 스캔·이미지만 있는 문서는 텍스트가 있는 DOCX/HWP로 저장해 주세요.');
  }
  return blocks;
}

const escapeXml = (value) => value
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paragraphXml(text) {
  const runs = text.split('\n').map((line, index) => {
    const pieces = line.split('\t').map((part) => `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('<w:tab/>');
    return `${index ? '<w:br/>' : ''}${pieces}`;
  }).join('');
  return `<w:p><w:r>${runs}</w:r></w:p>`;
}

/** A minimal DOCX with the same paragraphs and table rows, for the shared DOCX form reader. Consecutive rows form one table. */
export function legacyWordBlocksToDocx(blocks) {
  const body = [];
  let tableRows = [];
  const closeTable = () => {
    if (tableRows.length) body.push(`<w:tbl>${tableRows.join('')}</w:tbl>`);
    tableRows = [];
  };
  for (const block of blocks) {
    if (block.kind === 'row') {
      tableRows.push(`<w:tr>${block.cells.map((value) => `<w:tc>${(value || '').split('\n').map(paragraphXml).join('') || '<w:p/>'}</w:tc>`).join('')}</w:tr>`);
      continue;
    }
    closeTable();
    body.push(paragraphXml(block.text));
  }
  closeTable();
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
