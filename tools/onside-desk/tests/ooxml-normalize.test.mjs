import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { normalizeDocxPackage, normalizeWordXml, completeThemeStyleLists } from '../ooxml-normalize.mjs';
import { mergeIntegratedForms } from '../integrated-merge.mjs';
import { assertStrictPackage } from './strict-package.mjs';
import { generateDocuments } from '../documents.mjs';
import { windowsText, attachmentDisposition } from '../core.mjs';

const desk = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(path.dirname(desk));
const templateDirs = [path.join(desk, 'templates'), path.join(repo, 'templates', 'review-docs')];
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

test('every stored template already satisfies a strict reader, and normalizing it again changes nothing', async () => {
  let count = 0;
  for (const dir of templateDirs) {
    for (const name of (await fs.readdir(dir)).filter((file) => file.endsWith('.docx'))) {
      const buffer = await fs.readFile(path.join(dir, name));
      assertStrictPackage(buffer, `${path.basename(dir)}/${name}`);
      assert.deepEqual(normalizeDocxPackage(buffer).changes, [], `${path.basename(dir)}/${name} is stored normalized`);
      count += 1;
    }
  }
  assert.equal(count, 16);
});

test('a table whose borders were written after its layout, with start/end sides, comes out in schema order with lines on every cell', () => {
  const source = `<?xml version="1.0"?><w:document ${W} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14 w15"><w:body>`
    + '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:jc w:val="start"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:start w:val="single" w:sz="8" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>'
    + '<w:tr><w:tc><w:tcPr><w:vAlign w:val="center"/><w:shd w:fill="EDEDED"/><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>'
    + '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/><w:ind w:start="10" w:end="20"/><w:keepNext/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:b/><w:b/><w:rFonts w:ascii="맑은 고딕"/></w:rPr><w:t xml:space="preserve"> {album_title} </w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:sectPr><w:docGrid w:linePitch="360"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
  const { xml, changes } = normalizeWordXml(source, { borders: true });
  assert.ok(changes.includes('mc:Ignorable') && changes.includes('order of w:tblPr') && changes.includes('cell borders'));
  assert.doesNotMatch(xml, /Ignorable/);
  assert.match(xml, /<w:tblPr><w:tblW[^>]*\/><w:jc w:val="left"\/><w:tblBorders>.*<\/w:tblBorders><w:tblLayout/);
  assert.match(xml, /<w:tblBorders><w:top[^>]*\/><w:left[^>]*\/><w:bottom w:val="single" w:sz="8"[^>]*\/><w:right[^>]*\/><w:insideH[^>]*\/><w:insideV[^>]*\/><\/w:tblBorders>/);
  assert.match(xml, /<w:tcPr><w:tcW[^>]*\/><w:tcBorders><w:top w:val="single" w:sz="8"[^>]*\/><w:left[^>]*\/><w:bottom[^>]*\/><w:right[^>]*\/><\/w:tcBorders><w:shd w:fill="EDEDED" w:val="clear" w:color="auto"\/><w:vAlign w:val="center"\/><\/w:tcPr>/);
  assert.match(xml, /<w:pPr><w:keepNext\/><w:spacing w:after="0"\/><w:ind w:left="10" w:right="20"\/><w:jc w:val="center"\/><\/w:pPr>/);
  assert.match(xml, /<w:rPr><w:rFonts[^>]*\/><w:b\/><w:sz w:val="20"\/><\/w:rPr>/);
  assert.match(xml, /<w:sectPr><w:pgSz[^>]*\/><w:docGrid[^>]*\/><\/w:sectPr>/);
  // The text, its spacing and the template tag are untouched.
  assert.match(xml, /<w:t xml:space="preserve"> \{album_title\} <\/w:t>/);
  // A second pass has nothing left to do.
  assert.deepEqual(normalizeWordXml(xml, { borders: true }).changes, []);
});

test('an incomplete theme gets the three entries each style list needs', () => {
  const theme = '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="t"><a:themeElements><a:fmtScheme name="f">'
    + '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"/></a:lnStyleLst>'
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
    + '</a:fmtScheme></a:themeElements></a:theme>';
  const repaired = completeThemeStyleLists(theme);
  assert.equal(repaired.split('<a:ln ').length - 1, 3);
  assert.equal(repaired.split('<a:effectStyle>').length - 1, 3);
  assert.equal(repaired.split('<a:solidFill>').length - 1, 6);
  assert.equal(completeThemeStyleLists(repaired), repaired);
});

test('every document the desk generates satisfies a strict reader, whatever the lyrics contain', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-strict-'));
  try {
    const lyrics = '첫 줄 & <둘째> "셋째"\n\nStay with me\n(번역: 내 곁에 있어줘)\n君を待っている 🎵\n' + Array.from({ length: 40 }, (_, index) => `${index + 1}절 가사`).join('\n');
    const result = await generateDocuments({
      source: 'manual', outputDir: dir, settings: { pagination: false, applicationDate: '2026-11-19' },
      submission: { id: 'fixture', type: 'ALBUM', title: '가을의 노래 (Autumn)', artist_name: '검증 가수', release_date: '2026-12-01', genre: '발라드', distributor: '유통사', production_company: '제작사' },
      tracks: [
        { track_no: 1, track_title: '첫 번째 노래', is_title: true, lyricist: '작사가', composer: '작곡가', arranger: '편곡가', lyrics },
        { track_no: 2, track_title: '첫 번째 노래 (Inst.)', composer: '작곡가', lyrics: '' },
      ],
    });
    const documents = result.artifacts.filter((artifact) => artifact.type === 'docx');
    assert.equal(documents.length, 9);
    for (const artifact of documents) assertStrictPackage(await fs.readFile(artifact.path), artifact.name);
    // The archives carry the same files, with Korean names marked as UTF-8 for Windows.
    const centralEntry = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    for (const artifact of result.artifacts.filter((item) => item.type === 'zip')) {
      const archive = await fs.readFile(artifact.path);
      const zip = new PizZip(archive, { checkCRC32: true });
      for (const [name, file] of Object.entries(zip.files)) {
        if (!file.dir) assertStrictPackage(file.asNodeBuffer(), `${artifact.name} › ${name}`);
      }
      // General purpose bit 11 of each central directory entry.
      let entries = 0;
      for (let offset = archive.indexOf(centralEntry); offset >= 0; offset = archive.indexOf(centralEntry, offset + 4)) {
        assert.ok(archive.readUInt16LE(offset + 8) & 0x800, 'UTF-8 file name flag');
        entries += 1;
      }
      assert.ok(entries >= 6);
    }
    // Text files open in Windows Notepad with Korean text and line breaks intact.
    for (const artifact of result.artifacts.filter((item) => item.type === 'text')) {
      const bytes = await fs.readFile(artifact.path);
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${artifact.name} starts with the UTF-8 mark`);
      assert.doesNotMatch(bytes.toString('utf8'), /(?<!\r)\n/, `${artifact.name} uses CRLF line ends`);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('text and download names are written the way Windows reads them', () => {
  assert.equal(windowsText('가\n나\r\n다\r라'), '﻿가\r\n나\r\n다\r\n라');
  assert.equal(windowsText(windowsText('한 줄')), '﻿한 줄');
  const header = attachmentDisposition("가사_슬로울리(slowly)_It's *OK*!.doc");
  assert.match(header, /^attachment; filename\*=UTF-8''[A-Za-z0-9%._~-]+$/);
  assert.equal(decodeURIComponent(header.split("''")[1]), "가사_슬로울리(slowly)_It's *OK*!.doc");
});

test('a merged 통합신청서 made from forms generated before the fix comes out strict as well', async () => {
  // What an older generation looked like: borders written after the layout, no cell borders, a folder entry.
  const legacy = async (name, album) => {
    const row = { album_title: album, artist_display: `${album} 가수`, company_actual: `${album} 회사`, review_songs_text: `${album} 곡`, today_md: '11/19', genre: '발라드', row_no: 1 };
    const doc = new Docxtemplater(new PizZip(await fs.readFile(path.join(desk, 'templates', name))), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render({ ...row, albums: [row] });
    const zip = doc.getZip();
    const xml = zip.file('word/document.xml').asText()
      .replace(/(<w:tblBorders>[\s\S]*?<\/w:tblBorders>)(<w:tblLayout[^>]*\/>)/, '$2$1')
      .replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g, '');
    zip.file('word/document.xml', xml);
    zip.folder('word');
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  };
  const files = [{ name: 'a.docx', body: await legacy('wbs-integrated.docx', '첫 앨범') }, { name: 'b.docx', body: await legacy('wbs-integrated.docx', '둘째 앨범') }];
  assert.throws(() => assertStrictPackage(files[0].body, 'old form'));
  const merged = mergeIntegratedForms({ station: 'WBS', files });
  assert.equal(merged.albums, 2);
  assertStrictPackage(merged.buffer, 'merged form');
  const text = new PizZip(merged.buffer).file('word/document.xml').asText();
  assert.ok(text.includes('첫 앨범') && text.includes('둘째 앨범'));
});
