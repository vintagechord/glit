import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractDocxBlocks, structureExtractedFile, DOMParser, readBoundedZip } from './manual-document-parser.mjs';
import { extractHwpBlocks, readCompoundStreams, OLE_SIGNATURE } from './manual-ole.mjs';

const MAX_BYTES = 20 * 1024 * 1024, MAX_TEXT = 600000;
const execFileAsync = promisify(execFile);
function fail(code, message) { const error = new Error(message); error.code = code; error.status = 400; throw error; }
const clean = (value) => String(value ?? '').trim();
// Form labels often wrap qualifiers onto a second line, e.g. 아티스트\n(한글 및 영문).
// Only labels use this normalization; values and lyrics retain all parentheses.
const key = (value) => clean(value).toLowerCase().replace(/\([^)]*\)|（[^）]*）/g,'').replace(/[\s:：.\-_/()[\]]/g, '');
const fields = new Map();
function aliases(canonical, names) { for (const name of names.split('|')) fields.set(key(name), canonical); }
aliases('가수명', '아티스트|아티스트명|아트스트|가수|가수명|artist|artistname');
aliases('영문아티스트명', '영문명|영문아티스트명|가수영문명');
aliases('앨범명', '앨범명|음반명|음반제목|album|albumtitle');
aliases('기획사', '기획사|기획사명|소속사|소속사명|제작사|제작사명|기획사제작사|기획사소속사');
aliases('유통사', '유통사|발매사|배급사');
aliases('발매일', '발매일|발매일자|발매예정일|공개일자|영상공개일자|영상공개일|출시일');
aliases('제작일', '제작일|제작일자|제작연월일');
aliases('장르', '장르|음반장르|곡장르');
aliases('앨범형태', '음반형태|앨범형태');
aliases('그룹솔로', '그룹솔로|솔로그룹|구성|아티스트유형');
aliases('구성원', '구성원|멤버');
aliases('이전발매곡', '이전발매곡|이전발매이력');
aliases('트랙수', '심의요청곡수|트랙수|수록곡수|총곡수');
aliases('곡명', '곡명|곡제목|노래제목|title|tracktitle|트랙|뮤비제목|뮤직비디오명|뮤직비디오제목|영상제목|작품명');
aliases('트랙번호', '트랙번호|트랙넘버|번호|no|trackno');
aliases('타이틀여부', '타이틀|타이틀곡|타이틀여부');
aliases('작사', '작사|작사가|작사자');
aliases('작곡', '작곡|작곡가|작곡자');
aliases('편곡', '편곡|편곡자');
aliases('피처링', '피처링|피쳐링|featuring|feat');
aliases('실연자', '실연|실연자|연주자|연주|실연연주자|연주가악기명');
aliases('가사', '가사|가사원문|원문가사|lyrics|뮤비가사|뮤직비디오가사');
aliases('번역가사', '번역|한글번역|번역가사|한국어번역|한국어번역가사|한글번역가사');
aliases('Inst/MR', 'instmr|inst|mr|연주곡|반주곡');
const extraFields = new Map(), extraTitles = new Map();
function extra(field, names) { extraTitles.set(field,names.split('|')[0]);for (const name of names.split('|')) extraFields.set(key(name), field); }
extra('applicant_name', '신청자|신청인|신청자명|담당자|담당자명');
extra('applicant_email', '이메일|이메일주소|전자우편|e-mail|email|신청자이메일|메일주소');
extra('applicant_phone', '연락처|전화번호|휴대전화|휴대폰|휴대폰번호|신청자연락처');
extra('mv_runtime', '러닝타임|상영시간|재생시간|영상길이|분량');
extra('mv_director', '감독|뮤직비디오감독|뮤비감독|연출|연출자');
extra('mv_lead_actor', '주연|주연명|주연배우|출연|출연자');
extra('mv_storyline', '줄거리|내용|내용소개|시놉시스|작품내용|줄거리작품내용');
extra('mv_format', '영상포맷|포맷|영상규격|파일형식');
extra('mv_production_company', '영상제작사|뮤비제작사|뮤직비디오제작사');
extra('mv_agency', '대행사|신청대행사');
extra('mv_distribution_company', '배급업체|배급업자|배급회사');
extra('mv_business_reg_no', '사업자등록번호|사업자번호');
extra('mv_usage', '용도|이용목적|사용목적');
extra('mv_desired_rating', '희망등급|신청등급|희망연령등급');
extra('mv_memo', '비고|메모|특이사항');
extra('mv_song_title_en', '영문곡명|영문제목|영문작품명');
extra('mv_song_title_kr', '국문곡명|국문제목|한글곡명|한글제목');

function xmlDocument(bytes) {
  const xml = bytes.toString('utf8');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml) || xml.includes('\0')) fail('XML_UNSAFE', '외부 엔티티 또는 지원하지 않는 XML 인코딩이 포함되어 있습니다.');
  if ((xml.match(/</g) ?? []).length > 150000) fail('ARCHIVE_LIMIT', '문서 구조가 너무 복잡합니다.');
  try { return new DOMParser({ onError: () => { throw new Error('invalid XML'); } }).parseFromString(xml, 'text/xml'); }
  catch { fail('CORRUPT', '문서 XML 구조가 손상되었습니다.'); }
}
const elements = (node) => Array.from(node.childNodes ?? []).filter((child) => child.nodeType === 1);
function hwpxParagraph(node, depth = 0) {
  if (depth > 100) fail('ARCHIVE_LIMIT', '문서 구조가 너무 깊습니다.');
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.localName === 'tbl') return '';
  if (node.localName === 'lineBreak') return '\n';
  if (node.localName === 'tab') return '\t';
  if (['pic', 'ole', 'equation', 'script'].includes(node.localName)) return '';
  return Array.from(node.childNodes ?? []).map((child) => hwpxParagraph(child, depth + 1)).join('');
}
export function extractHwpxBlocks(body) {
  const parts = readBoundedZip(body), names = [...parts.keys()];
  if (names.some((name) => /(?:^|\/)(?:encryption|drm)[^/]*\.xml$/i.test(name))) fail('ENCRYPTED', '암호·DRM 보호 문서는 읽을 수 없습니다.');
  const sections = names.filter((name) => /^Contents\/section\d+\.xml$/.test(name)).sort((a,b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!sections.length) fail('FORMAT_MISMATCH', 'HWPX 본문이 없습니다. 실제 HWPX 문서를 사용해 주세요.');
  const blocks = []; let count = 0, total = 0;
  const append = (block) => { total += block.text.length; if (total > MAX_TEXT || ++count > 30000) fail('TEXT_LIMIT', '문서 본문이 600,000자 또는 30,000문단을 초과했습니다.'); blocks.push(block); };
  function visit(node, location, depth = 0) {
    if (depth > 100) fail('ARCHIVE_LIMIT', '문서 구조가 너무 깊습니다.');
    if (node.localName === 'tbl') {
      for (const [index, row] of elements(node).filter((el) => el.localName === 'tr').entries()) {
        const cells = elements(row).filter((el) => el.localName === 'tc').map((cell, col) => {
          const paragraphs = Array.from(cell.getElementsByTagName('*')).filter((el) => el.localName === 'p');
          const span = Array.from(cell.getElementsByTagName('*')).find((el) => el.localName === 'cellSpan');
          return { text: paragraphs.map((p) => hwpxParagraph(p).trimEnd()).join('\n').trim(), column: col + 1, colSpan: Number(span?.getAttribute('colSpan')) || 1 };
        });
        append({ text: cells.map((cell) => cell.text).join('\t'), cells, kind: 'tableRow', location: `${location}/row:${index+1}` });
      }
      return;
    }
    if (node.localName === 'p') {
      const text = hwpxParagraph(node).trimEnd();
      if (text) append({ text, kind: 'paragraph', location });
      // Tables are embedded inside paragraph runs. The parent paragraph excludes
      // their text so every lyric paragraph is read exactly once.
      for (const table of Array.from(node.getElementsByTagName('*')).filter((el) => el.localName === 'tbl' && !hasAncestor(el, 'tbl', node))) visit(table, location + '/table', depth + 1);
      return;
    }
    elements(node).forEach((child, index) => visit(child, `${location}/${index+1}`, depth + 1));
  }
  for (const section of sections) visit(xmlDocument(parts.get(section)()).documentElement, section);
  return { format: 'hwpx', blocks, warnings: ['HWPX의 표·가사 읽기 순서를 원문과 비교해 주세요. 외부 링크와 첨부 개체는 실행하지 않습니다.'] };
}
function hasAncestor(node, name, limit) { for (let parent = node.parentNode; parent && parent !== limit; parent = parent.parentNode) if (parent.localName === name) return true; return false; }

async function extractLegacyDoc(body) {
  if (process.platform !== 'darwin') fail('CONVERTER_UNAVAILABLE', '구형 DOC는 이 Mac의 문서 변환기로 읽습니다. DOCX로 저장하면 다른 환경에서도 읽을 수 있습니다.');
  const streams = readCompoundStreams(body);
  const word = streams.get('WordDocument')?.();
  if (!word || word.length < 32 || word.readUInt16LE(0) !== 0xa5ec) fail('FORMAT_MISMATCH', '실제 구형 Word DOC 파일이 아닙니다. DOCX로 저장 후 다시 불러와 주세요.');
  if (word.readUInt16LE(10) & (0x100 | 0x8000)) fail('ENCRYPTED', '암호화된 Word 문서는 지원하지 않습니다.');
  if ([...streams.keys()].some((name) => /(?:^|\/)(?:VBA|Macros|ObjectPool)(?:\/|$)/i.test(name))) fail('ACTIVE_CONTENT', '매크로·삽입 개체가 포함된 DOC는 DOCX 텍스트 문서로 다시 저장해 주세요.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-manual-doc-'));
  try {
    const input = path.join(temporary, 'source.doc'); await fs.writeFile(input, body, { mode: 0o600 });
    let result;
    try { result = await execFileAsync('/usr/bin/textutil', ['-convert', 'docx', '-stdout', input], { timeout: 30000, maxBuffer: 20 * 1024 * 1024, encoding: 'buffer', windowsHide: true }); }
    catch { fail('CONVERSION_FAILED', '구형 DOC를 변환하지 못했습니다. Word 또는 한글에서 DOCX로 저장 후 다시 불러와 주세요.'); }
    const extracted = extractDocxBlocks(result.stdout);
    return { ...extracted, format: 'doc', warnings: [...extracted.warnings, '구형 Word DOC를 Mac 문서 변환기로 읽었습니다. 표·크레딧·전체 가사와 줄바꿈을 원문과 비교해 주세요.'] };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

const row = (label, value, location) => ({ text: `${label}\t${value}`, kind: 'tableRow', location, cells: [{text:label,column:1},{text:value,column:2}] });
const canonical = (label) => fields.get(key(label));
const numbered = (text) => clean(text).match(/^(?:트랙\s*)?(\d{1,3})[.)]\s*(\S.*)$/);
const creditLine = (text) => /^\s*\(?\s*(?:작사|작곡|편곡|곡)\s*[:：]/.test(text);
function checkedChoice(label, value) {
  if (!['장르','앨범형태','그룹솔로'].includes(label) || !/[□■☐☑☒]/.test(value)) return value;
  const selected = [...value.matchAll(/([^□■☐☑☒]+)([□■☐☑☒])/g)].filter((match) => /[■☑☒]/.test(match[2])).map((match) => match[1].trim()).filter(Boolean);
  return selected.length ? selected.join(', ') : value;
}
function formValue(label, value, warnings) {
  // Empty-form guidance is not a company, date, contact, or rating supplied by
  // the applicant. Preserve it in extractedText and explain the blank field.
  if (!['가사','번역가사','mv_storyline','mv_memo'].includes(label) && /(?:(?:작성|기입|입력)\s*부탁(?:드립|드립니다)|없으면\s*안\s*적으셔도|없을\s*시\s*미기입)/.test(value)) {
    warnings.push(`${extraTitles.get(label)||label}: 기준파일의 입력 안내문만 있어 값을 비웠습니다. 실제 내용을 확인해 주세요.`);
    return '';
  }
  return checkedChoice(label,value);
}
function normalizeBlocks(result, type, warnings) {
  const input = result.blocks.flatMap((block) => {
    if (block.cells || !block.text.includes('\n')) return [block];
    const first = canonical(block.text.split(/[:：]/)[0]);
    return first && !['가사','번역가사'].includes(first) ? block.text.split('\n').map((text,index) => ({...block,text,location:`${block.location}/line:${index+1}`})) : [block];
  }), output = [], extras = {}, tableArtists = [];
  let artistColumn = -1, artistTable = '';
  let lyricBuffer, lyricLocation, lyricField = '가사', activeTrack = false, trackTable = '', creditSeen = false, sawNumbered = false;
  const flush = () => { if (lyricBuffer) output.push(row(lyricField, lyricBuffer.join('\n'), lyricLocation)); lyricBuffer = undefined; };
  const extraValue = (field, value) => {
    value=formValue(field,value,warnings);
    if (!value) return;
    if (field === 'applicant_name' && /^[+\d\s()\-]+$/.test(value)) field = 'applicant_phone';
    if (extras[field] && extras[field] !== value) warnings.push(`${extraTitles.get(field)||field}: 원문 값이 여러 개입니다. 원문을 비교하여 선택해 주세요.`); else extras[field] = value;
  };
  for (let index = 0; index < input.length; index++) {
    const block = input[index], text = block.text.trim(), location = block.location;
    if (block.cells) {
      flush();
      let cells = block.cells.map((cell) => ({ ...cell, text: cell.text.trim() }));
      if (cells.every((cell) => !cell.text)) continue;
      if (cells.length === 1 && index === input.findIndex((item) => item.text.trim()) && !canonical(text) && input.slice(index+1,index+4).some((item) => item.cells?.some((cell) => canonical(cell.text) === '가수명'))) {
        output.push(row('앨범명', text, location)); warnings.push('첫 표 제목을 앨범명으로 읽었습니다. 원문과 앨범명을 확인해 주세요.'); continue;
      }
      if (canonical(cells[0].text) === '트랙번호' && cells.length === 3 && /^\d+$/.test(cells[1].text)) {
        output.push(row('트랙번호', cells[1].text, location), row('곡명', cells[2].text, location));
        activeTrack = true; creditSeen = false; trackTable = location.replace(/\/row:?\d+$/, ''); continue;
      }
      if (cells.length === 1 && activeTrack && creditSeen && location.replace(/\/row:?\d+$/, '') === trackTable && !canonical(text)) {
        output.push(row('가사', text, location)); warnings.push('트랙 크레딧 아래의 병합 셀을 가사로 읽었습니다. 전체 가사를 확인해 주세요.'); continue;
      }
      const keys = cells.map((cell) => canonical(cell.text));
      const isHeader = keys.includes('곡명') && keys.filter(Boolean).length >= 2 && cells.every((cell, i) => !cell.text || keys[i]);
      if (isHeader) {
        artistColumn = keys.indexOf('가수명'); artistTable = location.replace(/\/row:?\d+$/, '');
        cells = cells.map((cell) => ({...cell,text:key(cell.text)==='트랙' ? '트랙번호' : canonical(cell.text) === '가수명' ? '실연자' : canonical(cell.text) || cell.text}));
      }
      else {
        if (artistColumn >= 0 && location.replace(/\/row:?\d+$/, '') === artistTable && !keys[0] && cells[artistColumn]?.text) tableArtists.push(cells[artistColumn].text);
        for (let c = 0; c < cells.length - 1; c++) {
          const extraField = extraFields.get(key(cells[c].text));
          if (extraField) { extraValue(extraField, cells[c+1].text); cells[c].text = ''; cells[c+1].text = ''; c++; }
          else if (canonical(cells[c].text)) {
            cells[c].text = canonical(cells[c].text);
            cells[c+1].text = formValue(cells[c].text,cells[c+1].text,warnings);
            if (cells[c].text === '곡명') { activeTrack = true; trackTable = location.replace(/\/row:?\d+$/, ''); creditSeen = false; }
            if (['작사','작곡','편곡','실연자'].includes(cells[c].text)) creditSeen = true;
            c++;
          }
        }
      }
      if (cells.some((cell) => cell.text)) output.push({...block,cells,text:cells.map((cell) => cell.text).join('\t')});
      continue;
    }
    if (creditLine(text) && (/^\s*\(/.test(text) || (text.match(/(?:작사|작곡|편곡)\s*[:：]/g) ?? []).length > 1)) {
      flush();
      for (const match of text.matchAll(/(작사|작곡|편곡|곡)\s*[:：]\s*([\s\S]*?)(?=\s+(?:작사|작곡|편곡|곡)\s*[:：]|$)/g)) output.push(row(match[1] === '곡' ? '작곡' : match[1],match[2].replace(/\)\s*$/, '').trim(),location));
      creditSeen = true; continue;
    }
    const labeled = text.match(/^([^:：\t]{1,30})\s*[:：\t]\s*([\s\S]*)$/), label = labeled && (canonical(labeled[1]) || extraFields.get(key(labeled[1])));
    if (label) {
      flush();
      if (extraFields.has(key(labeled[1]))) { extraValue(label,labeled[2]); continue; }
      if (['가사','번역가사'].includes(label)) { lyricField = label; lyricLocation = location; lyricBuffer = [labeled[2]]; activeTrack = true; continue; }
      output.push(row(label,formValue(label,labeled[2],warnings),location));
      if (label === '곡명') { activeTrack = true; creditSeen = false; lyricField = '가사'; }
      if (['작사','작곡','편곡'].includes(label)) creditSeen = true;
      continue;
    }
    const only = canonical(text), extraOnly=extraFields.get(key(text));
    if (only === '가사' || only === '번역가사') { flush(); lyricField = only; lyricLocation = location; lyricBuffer = []; activeTrack = true; continue; }
    if (only && input[index+1] && !canonical(input[index+1].text) && !input[index+1].cells) {
      flush(); output.push(row(only,formValue(only,input[++index].text,warnings),location)); if (only === '곡명') activeTrack = true; continue;
    }
    if(extraOnly && input[index+1] && !canonical(input[index+1].text) && !extraFields.has(key(input[index+1].text)) && !input[index+1].cells) {flush();extraValue(extraOnly,input[++index].text);continue;}
    const number = numbered(text);
    if (number && (!lyricBuffer || /^트랙/.test(text) || creditLine(input[index+1]?.text ?? '') || creditLine(input[index+2]?.text ?? ''))) {
      flush(); output.push(row('트랙번호',number[1],location),row('곡명',number[2],location)); activeTrack = true; sawNumbered = true; creditSeen = false; lyricField = '가사'; continue;
    }
    // A conventional lyrics-sheet heading carries explicit artist/title/genre.
    const heading = !activeTrack && text.match(/^(.+?)\s+-\s+(.+?)(?:\s*\(장르\s*[:：]\s*(.+?)\))?\s*$/);
    if (heading && !/^(?:[-※]|참고|안내)/.test(text)) {
      flush(); output.push(row('가수명',heading[1],location),row(type === 'ALBUM' ? '앨범명' : '곡명',heading[2],location));
      if (heading[3]) output.push(row('장르',heading[3],location));
      if (type !== 'ALBUM') { activeTrack = true; lyricBuffer = []; lyricLocation = location; lyricField = '가사'; }
      continue;
    }
    if (/^(?:※|참고\s*[:：]|안내\s*[:：]|접수일자\s*[:：])/.test(text)) { flush(); output.push(block); continue; }
    if (lyricBuffer || (activeTrack && (creditSeen || sawNumbered))) {
      if (!lyricBuffer) { lyricBuffer = []; lyricLocation = location; lyricField = '가사'; } lyricBuffer.push(block.text); continue;
    }
    output.push(block);
  }
  flush(); return { blocks: output, extras, tableArtists: [...new Set(tableArtists)] };
}

export async function importReferenceDocument({ body, filename, type = 'ALBUM' }) {
  if (!['ALBUM','MV_DISTRIBUTION','MV_BROADCAST'].includes(type)) fail('INVALID_TYPE', '음반 또는 뮤비 작업 유형을 선택해 주세요.');
  if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) fail('INVALID_BODY', '기준 문서 파일을 선택해 주세요.');
  body = Buffer.from(body);
  if (!body.length || body.length > MAX_BYTES) fail('UPLOAD_LIMIT', '기준 문서는 20MB 이하의 비어 있지 않은 파일을 사용해 주세요.');
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!['.docx','.doc','.hwp','.hwpx'].includes(extension)) fail('UNSUPPORTED_FORMAT', 'DOCX, DOC, HWP 5.0, HWPX 기준 문서를 지원합니다. 스캔 이미지는 텍스트 문서로 변환해 주세요.');
  if (body.subarray(0,8).equals(OLE_SIGNATURE) && ['.docx','.hwpx'].includes(extension)) fail('ENCRYPTED', '암호화된 문서이거나 확장자와 실제 형식이 다릅니다. 보호를 해제하고 원래 형식으로 저장해 주세요.');
  let result;
  try { result = extension === '.docx' ? extractDocxBlocks(body) : extension === '.hwpx' ? extractHwpxBlocks(body) : extension === '.hwp' ? extractHwpBlocks(body) : await extractLegacyDoc(body); }
  catch (error) { if (error.code === 'EMPTY_DOCUMENT') fail('NO_TEXT', '읽을 수 있는 본문이 없습니다. 스캔·이미지만 있는 문서는 텍스트가 포함된 DOCX/HWPX로 저장해 주세요.'); error.status ??= 400; throw error; }
  const extractedText = result.blocks.map((block) => block.text).join('\n');
  if (extractedText.length > MAX_TEXT) fail('TEXT_LIMIT', '원문이 600,000자를 초과했습니다. 뒷부분을 생략하지 않았습니다. 파일을 나누어 주세요.');
  if (!extractedText.trim()) fail('NO_TEXT', '읽을 수 있는 본문이 없습니다. 스캔·이미지만 있는 문서는 텍스트가 포함된 DOCX/HWPX로 저장해 주세요.');
  const warnings = [...result.warnings, type==='ALBUM' ? '자동 입력한 제목·트랙 순서·크레딧·전체 가사를 원문과 비교한 뒤 자료를 생성해 주세요.' : '자동 입력한 가수·영상 제목·감독·주연·줄거리·전체 가사를 원문과 비교한 뒤 자료를 생성해 주세요.'];
  const normalized = normalizeBlocks(result,type,warnings);
  const source = { id: randomUUID(), kind:'file', name:String(filename), format:result.format, text:extractedText, warnings:result.warnings };
  let parsed;
  try { parsed = structureExtractedFile(source,{...result,blocks:normalized.blocks},type === 'ALBUM' ? 'album' : 'mv'); }
  catch { fail('STRUCTURE_LIMIT', '문서 항목이 허용 길이를 초과하거나 구조를 확인할 수 없습니다. 문서를 나누거나 항목을 정리해 주세요.'); }
  if (parsed.albums.length > 1) fail('MULTIPLE_ALBUMS', '기준 문서에 서로 다른 앨범명이 있습니다. 한 작업에 한 앨범 또는 한 뮤비가 들어가도록 파일을 나누어 주세요.');
  const album = parsed.albums[0] ?? {}, tracks = (album.tracks ?? []).map((track) => ({
    id:track.id, track_no:track.number, track_title:track.title, performer:track.artistName || track.performers || '', featuring:track.featuring,
    composer:track.composer, lyricist:track.lyricist, arranger:track.arranger, lyrics:track.lyrics, translated_lyrics:track.existingTranslation,
    is_title:track.isTitle, is_instrumental:track.instrumentalConfirmed, instrumental_confirmed:track.instrumentalConfirmed,
  }));
  if (tracks.length > 999) fail('TRACK_LIMIT', '한 작업에 999곡까지 읽을 수 있습니다. 뒷부분을 생략하지 않았습니다. 파일을 나누어 주세요.');
  warnings.push(...parsed.issues.map((issue) => issue.message));
  const artistFromTracks = normalized.tableArtists;
  const submission = { ...normalized.extras, title:album.title || '', artist_name:album.artistName || (artistFromTracks.length === 1 ? artistFromTracks[0] : ''), artist_name_en:album.artistNameEn || '',
    production_company:album.company || '', distributor:album.distributor || '', distributor_name:album.distributor || '', release_date:album.releaseDate || '', production_date:album.productionDate || '', genre:album.genre || '',
    artist_type:album.actType || '', album_type:album.albumType || '', members:album.members || '', previous_release:album.previousReleases || '',
  };
  if (type !== 'ALBUM') {
    if (tracks.length > 1) fail('MULTIPLE_MV_SONGS','뮤비 기준파일에서 서로 다른 곡을 읽었습니다. 한 작업에 한 뮤비가 들어가도록 파일을 나누어 주세요.');
    const track = tracks[0] ?? {};
    Object.assign(submission,{ title:track.track_title || submission.title, mv_song_title:track.track_title || '', mv_album_title:album.title || '', mv_lyrics:track.lyrics || '', original_lyrics:track.lyrics || '', korean_lyrics_translation:track.translated_lyrics || '', mv_composer:track.composer || '', mv_lyricist:track.lyricist || '', mv_arranger:track.arranger || '', mv_production_date:album.productionDate || '' });
    submission.mv_production_company ||= album.company || ''; submission.mv_distribution_company ||= album.distributor || '';
  }
  if (!submission.artist_name) warnings.push('가수명/아티스트명을 확인하여 입력해 주세요.');
  for (const [label,value] of [['발매일',submission.release_date],['제작일',submission.production_date]]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) warnings.push(`${label} '${value}'의 연도·월·일을 확인해 주세요. 원문 표기를 그대로 보존했습니다.`);
  if (!submission.title) warnings.push(type === 'ALBUM' ? '앨범명을 확인하여 입력해 주세요.' : '뮤비 제목을 확인하여 입력해 주세요.');
  if (type==='ALBUM') {
    if (!tracks.length) warnings.push('트랙을 자동으로 연결하지 못했습니다. 보존된 원문을 보고 곡 정보를 입력해 주세요.');
    if (album.declaredTrackCount && album.declaredTrackCount !== tracks.length) warnings.push(`원문의 곡 수(${album.declaredTrackCount})와 읽은 트랙 수(${tracks.length})가 다릅니다. 누락·중복 여부를 확인해 주세요.`);
    for (const track of tracks) if (!track.lyrics?.trim() && !track.is_instrumental) warnings.push(`${track.track_no}번 ${track.track_title || '(제목 미입력)'}: 가사가 없습니다. 가사를 입력하거나 원문의 Inst./MR 표기를 확인해 주세요.`);
  } else if (!submission.mv_lyrics.trim()) warnings.push('뮤직비디오 가사가 없습니다. 보존된 원문을 보고 가사를 입력해 주세요.');
  return { submission, tracks:type==='ALBUM'?tracks:[], extractedText, warnings:[...new Set(warnings)], format:result.format };
}
