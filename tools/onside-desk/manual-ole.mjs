import { inflateRawSync } from 'node:zlib';

// Read-only implementation of MS-CFB and Hancom HWP 5.0 record containers.
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/
// https://tech.hancom.com/python-hwp-parsing-2/
const END = 0xfffffffe, FREE = 0xffffffff;
export const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
function fail(code, message) { const error = new Error(message); error.code = code; error.status = 400; throw error; }

/** Bounded, lazy streams. Never executes macros, opens links, or writes archive paths. */
export function readCompoundStreams(bytes) {
  if (bytes.length < 512 || !bytes.subarray(0, 8).equals(OLE_SIGNATURE)) fail('FORMAT_MISMATCH', '한글/Word 문서 형식이 올바르지 않습니다.');
  const major = bytes.readUInt16LE(26), shift = bytes.readUInt16LE(30);
  if (bytes.readUInt16LE(28) !== 0xfffe || !((major === 3 && shift === 9) || (major === 4 && shift === 12)) || bytes.readUInt16LE(32) !== 6 || bytes.readUInt32LE(56) !== 4096) fail('CORRUPT', '문서 저장 구조가 손상되었거나 지원하지 않는 형식입니다.');
  const sectorSize = 2 ** shift, sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  const sector = (id) => {
    if (!Number.isInteger(id) || id < 0 || id >= sectorCount) fail('CORRUPT', '문서 저장 영역이 파일 범위를 벗어났습니다.');
    return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const fatCount = bytes.readUInt32LE(44), difatCount = bytes.readUInt32LE(72);
  if (fatCount > sectorCount || difatCount > sectorCount || !fatCount) fail('CORRUPT', '문서 저장 영역 목록이 손상되었습니다.');
  const fatIds = [];
  for (let i = 0; i < 109; i++) { const id = bytes.readUInt32LE(76 + i * 4); if (id !== FREE) fatIds.push(id); }
  let nextDifat = bytes.readUInt32LE(68);
  const difatSeen = new Set();
  for (let i = 0; i < difatCount; i++) {
    if (difatSeen.has(nextDifat)) fail('CORRUPT', '문서 저장 영역 목록이 순환합니다.');
    difatSeen.add(nextDifat);
    const data = sector(nextDifat);
    for (let p = 0; p < sectorSize - 4; p += 4) { const id = data.readUInt32LE(p); if (id !== FREE) fatIds.push(id); }
    nextDifat = data.readUInt32LE(sectorSize - 4);
  }
  if (fatIds.length !== fatCount || new Set(fatIds).size !== fatIds.length || (difatCount && nextDifat !== END)) fail('CORRUPT', '문서 저장 영역 목록의 길이가 일치하지 않습니다.');
  const fat = [];
  for (const id of fatIds) { const data = sector(id); for (let p = 0; p < sectorSize; p += 4) fat.push(data.readUInt32LE(p)); }
  function chain(start, table, unit, getUnit, size, limit = 80 * 1024 * 1024) {
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > limit)) fail('ARCHIVE_LIMIT', '문서 내부 데이터가 허용 크기를 초과했습니다.');
    if (size === 0) return Buffer.alloc(0);
    const pieces = [], seen = new Set(); let id = start;
    while (id !== END) {
      if (id >= table.length || seen.has(id) || pieces.length * unit >= limit) fail('CORRUPT', '문서 데이터가 손상되었거나 저장 영역이 순환합니다.');
      seen.add(id); pieces.push(getUnit(id)); id = table[id];
      if (size !== undefined && pieces.length > Math.ceil(size / unit)) fail('CORRUPT', '문서 데이터 길이가 저장 영역과 일치하지 않습니다.');
    }
    const total = pieces.length * unit;
    if (size !== undefined && (total < size || total - size >= unit)) fail('CORRUPT', '문서 데이터가 잘렸습니다.');
    return Buffer.concat(pieces, total).subarray(0, size ?? total);
  }
  const directory = chain(bytes.readUInt32LE(48), fat, sectorSize, sector, undefined, 4 * 1024 * 1024);
  const entries = [];
  for (let p = 0; p + 128 <= directory.length; p += 128) {
    const entry = directory.subarray(p, p + 128), type = entry[66], length = entry.readUInt16LE(64);
    if (type && (![1, 2, 5].includes(type) || length < 2 || length > 64 || length % 2)) fail('CORRUPT', '문서 항목 이름이 손상되었습니다.');
    const size = major === 3 ? entry.readUInt32LE(120) : Number(entry.readBigUInt64LE(120));
    entries.push({ type, name: type ? entry.subarray(0, length - 2).toString('utf16le') : '', left: entry.readUInt32LE(68), right: entry.readUInt32LE(72), child: entry.readUInt32LE(76), start: entry.readUInt32LE(116), size });
  }
  if (entries[0]?.type !== 5) fail('CORRUPT', '문서 루트 항목이 없습니다.');
  const miniCount = bytes.readUInt32LE(64);
  if (miniCount > sectorCount) fail('CORRUPT', '문서 소형 저장 영역 목록이 손상되었습니다.');
  const miniData = miniCount ? chain(bytes.readUInt32LE(60), fat, sectorSize, sector, miniCount * sectorSize) : Buffer.alloc(0);
  const miniFat = []; for (let p = 0; p < miniData.length; p += 4) miniFat.push(miniData.readUInt32LE(p));
  let miniStream;
  const getMini = (id) => {
    miniStream ??= chain(entries[0].start, fat, sectorSize, sector, entries[0].size);
    if ((id + 1) * 64 > miniStream.length) fail('CORRUPT', '문서 소형 저장 영역이 파일 범위를 벗어났습니다.');
    return miniStream.subarray(id * 64, (id + 1) * 64);
  };
  const streams = new Map(), visited = new Set([0]); let expanded = 0;
  function visit(id, prefix, depth = 0) {
    if (id === FREE) return;
    if (depth > 128 || id >= entries.length || visited.has(id)) fail('CORRUPT', '문서 항목 구조가 순환하거나 너무 깊습니다.');
    visited.add(id); const entry = entries[id];
    if (![1, 2].includes(entry.type) || /[/\\\0]/.test(entry.name)) fail('CORRUPT', '문서 항목 구조가 손상되었습니다.');
    visit(entry.left, prefix, depth + 1);
    const name = prefix + entry.name;
    if (entry.type === 1) visit(entry.child, name + '/', depth + 1);
    else {
      expanded += entry.size;
      if (expanded > 80 * 1024 * 1024 || streams.has(name)) fail('ARCHIVE_LIMIT', '문서 내부 데이터가 허용 크기를 초과했습니다.');
      streams.set(name, () => entry.size < 4096 ? chain(entry.start, miniFat, 64, getMini, entry.size) : chain(entry.start, fat, sectorSize, sector, entry.size));
    }
    visit(entry.right, prefix, depth + 1);
  }
  visit(entries[0].child, '');
  return streams;
}

function hwpParagraph(data) {
  if (data.length % 2) fail('CORRUPT', '한글 문서의 글자 데이터가 잘렸습니다.');
  const pieces = [];
  // HWP control characters occupy one UTF-16 unit, or an eight-unit control.
  const extended = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  for (let p = 0; p < data.length; p += 2) {
    const code = data.readUInt16LE(p);
    if (code >= 32) pieces.push(String.fromCharCode(code));
    else if (extended.has(code)) { if (p + 16 > data.length) fail('CORRUPT', '한글 문서의 제어 데이터가 잘렸습니다.'); if (code === 9) pieces.push('\t'); p += 14; }
    else if (code === 10) pieces.push('\n');
    else if (code === 24) pieces.push('-');
    else if (code === 30 || code === 31) pieces.push(' ');
  }
  return pieces.join('').trimEnd();
}

export function extractHwpBlocks(body) {
  const streams = readCompoundStreams(body), header = streams.get('FileHeader')?.();
  if (!header || header.length < 40 || !header.subarray(0, 17).equals(Buffer.from('HWP Document File'))) fail('FORMAT_MISMATCH', 'HWP 5.0 문서가 아닙니다. HWPX 또는 DOCX로 저장 후 불러와 주세요.');
  if (header[35] !== 5) fail('UNSUPPORTED_FORMAT', 'HWP 5.0 형식만 지원합니다. HWPX 또는 DOCX로 저장 후 불러와 주세요.');
  const flags = header.readUInt32LE(36);
  if (flags & (2 | 4 | 16 | 256 | 1024)) fail('ENCRYPTED', '암호·배포용·DRM 보호 문서는 읽을 수 없습니다. 보호를 해제한 파일을 사용해 주세요.');
  const sections = [...streams.keys()].filter((name) => /^BodyText\/Section\d+$/.test(name)).sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  if (!sections.length) fail('NO_TEXT', '한글 본문을 찾지 못했습니다. 미리보기만 있는 파일 또는 스캔 문서는 DOCX/HWPX 텍스트 문서로 다시 저장해 주세요.');
  const blocks = []; let total = 0, expanded = 0, recordCount = 0;
  for (const section of sections) {
    const compressed = streams.get(section)(); let data;
    try { data = flags & 1 ? inflateRawSync(compressed, { maxOutputLength: 8 * 1024 * 1024 }) : compressed; }
    catch { fail('CORRUPT', '한글 본문을 안전하게 압축 해제하지 못했습니다.'); }
    expanded += data.length;
    if (expanded > 80 * 1024 * 1024 || data.length > 8 * 1024 * 1024) fail('ARCHIVE_LIMIT', '한글 본문이 허용 크기를 초과했습니다.');
    let table, cell, pendingParagraph;
    const flushEmptyParagraph = () => {
      if (!pendingParagraph || pendingParagraph.foundText) return;
      if (pendingParagraph.cell) { pendingParagraph.cell.paragraphs.push(''); pendingParagraph.cell.text = pendingParagraph.cell.paragraphs.join('\n'); }
      else blocks.push({text:'',kind:'paragraph',location:pendingParagraph.location});
    };
    for (let p = 0; p < data.length;) {
      if (p + 4 > data.length || ++recordCount > 150000) fail('CORRUPT', '한글 본문 구조가 손상되었거나 너무 복잡합니다.');
      const header = data.readUInt32LE(p), tag = header & 1023, level = (header >>> 10) & 1023; p += 4;
      let length = header >>> 20;
      if (length === 4095) { if (p + 4 > data.length) fail('CORRUPT', '한글 본문 길이가 손상되었습니다.'); length = data.readUInt32LE(p); p += 4; }
      if (p + length > data.length) fail('CORRUPT', '한글 본문 데이터가 잘렸습니다.');
      if (tag === 66) flushEmptyParagraph();
      if (table && level <= table.level) { table = undefined; cell = undefined; }
      if (cell && level < cell.level) cell = undefined;
      if (tag === 66) pendingParagraph = { cell, location: `${section}/record:${recordCount}`, foundText:false };
      if (tag === 71 && length >= 4 && data.subarray(p, p + 4).toString('ascii') === ' lbt') {
        // A table is represented at its original position, with cells ordered by
        // explicit row/column addresses (including empty and merged cells).
        table = { level, rows: new Map(), location: `${section}/table:${recordCount}` };
        blocks.push(table);
      } else if (tag === 72 && table && level === table.level + 1 && length >= 34) {
        const column = data.readUInt16LE(p + 8), row = data.readUInt16LE(p + 10), colSpan = data.readUInt16LE(p + 12), rowSpan = data.readUInt16LE(p + 14);
        if (column > 1000 || row > 10000 || !colSpan || !rowSpan) fail('CORRUPT', '한글 표의 셀 주소가 손상되었습니다.');
        cell = { text: '', paragraphs: [], column: column + 1, colSpan, rowSpan, level };
        if (!table.rows.has(row)) table.rows.set(row, []);
        table.rows.get(row).push(cell);
      }
      if (tag === 67) {
        if (pendingParagraph) pendingParagraph.foundText = true;
        const text = hwpParagraph(data.subarray(p, p + length));
        total += text.length;
        if (total > 600000 || blocks.length >= 30000) fail('TEXT_LIMIT', '문서 본문이 600,000자 또는 30,000문단을 초과했습니다. 문서를 나누어 주세요.');
        if (cell) { cell.paragraphs.push(text); cell.text = cell.paragraphs.join('\n'); }
        else blocks.push({ text, location: `${section}/record:${recordCount}`, kind: 'paragraph', hwpLevel: level });
      }
      p += length;
    }
    flushEmptyParagraph();
  }
  return { format: 'hwp', blocks: blocks.flatMap((block) => block.rows ? [...block.rows.entries()].sort((a,b) => a[0]-b[0]).map(([row, cells]) => {
    cells.sort((a,b) => a.column-b.column);
    return { text: cells.map((cell) => cell.text).join('\t'), cells: cells.map(({text,column,colSpan,rowSpan}) => ({text,column,colSpan,rowSpan})), kind: 'tableRow', location: `${block.location}/row:${row+1}` };
  }) : [block]), warnings: ['HWP 본문 전체를 읽었습니다. 표·다단 문서의 읽기 순서와 가사·크레딧 연결을 원문과 비교해 주세요.'] };
}
