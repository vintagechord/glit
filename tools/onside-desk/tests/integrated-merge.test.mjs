import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { IntegratedMergeError, mergeIntegratedForms } from '../integrated-merge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const deskTemplates = path.join(here, '..', 'templates');
const webTemplates = path.join(here, '..', '..', '..', 'templates', 'review-docs');

const album = (n) => ({
  today_md: '11/0' + n, today_year: '2026', artist_display: `가수${n}`, manager_name: '정준영', manager_phone: '010-9068-9035',
  album_title: `앨범${n}`, title_track_title: `타이틀${n}`, title_track_title_primary: `타이틀${n}`, title_track_title_secondary: n === 2 ? `서브${n}` : '',
  company_actual: `회사${n}`, release_date_md: '10/2' + n, review_songs_text: `곡${n}`, genre: '발라드', row_no: 1,
});
// One integrated form per album, the way generation writes them.
function render(dir, template, n) {
  const doc = new Docxtemplater(new PizZip(fs.readFileSync(path.join(dir, template))), { paragraphLoop: true, linebreaks: true });
  doc.render({ ...album(n), albums: [album(n)] });
  return doc.getZip().generate({ type: 'nodebuffer' });
}
const rowsOf = (buffer) => {
  const xml = new PizZip(buffer).file('word/document.xml').asText();
  return [...xml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map((m) => [...m[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')));
};

test('TBS (음원심의신청서) forms of several albums become one form with every album row in order', () => {
  const files = [1, 2, 3].map((n) => ({ name: `TBS신청서_통합_${n}.docx`, body: render(deskTemplates, 'tbs-integrated.docx', n) }));
  const merged = mergeIntegratedForms({ station: 'TBS', files });
  assert.equal(merged.albums, 3); assert.equal(merged.filename, 'TBS신청서_통합_3건.docx'); assert.deepEqual(merged.warnings, []);
  const rows = rowsOf(merged.buffer);
  assert.equal(rows.length, 2 + 3 * 2, 'two header rows, two rows per album');
  assert.deepEqual(rows.slice(2).filter((_, i) => i % 2 === 0).map((cells) => cells[1]), ['가수1', '가수2', '가수3']);
  assert.match(rows[4].join('|'), /앨범2\|타이틀2\|서브2/);
  assert.equal(new PizZip(merged.buffer).file('word/document.xml').asText().match(/<w:tbl>/g).length, 1);
});

test('WBS rows are renumbered and the same album uploaded twice is listed once', () => {
  const files = [1, 2, 2, 3].map((n, i) => ({ name: `WBS_${i}.docx`, body: render(deskTemplates, 'wbs-integrated.docx', n) }));
  const merged = mergeIntegratedForms({ station: 'WBS', files });
  assert.equal(merged.albums, 3); assert.equal(merged.duplicates.length, 1);
  const rows = rowsOf(merged.buffer);
  assert.deepEqual(rows.slice(1).map((cells) => [cells[0], cells[2]]), [['1', '가수1'], ['2', '가수2'], ['3', '가수3']]);
});

test('PBC (심의 음반 접수 목록) from the desk and the web merge alike; a form of the other station is flagged', () => {
  const desk = mergeIntegratedForms({ station: 'PBC', files: [1, 2].map((n) => ({ name: `PBC_${n}.docx`, body: render(deskTemplates, 'pbc-integrated.docx', n) })) });
  assert.equal(desk.albums, 2); assert.deepEqual(desk.warnings, []);
  assert.deepEqual(rowsOf(desk.buffer).slice(1).map((cells) => cells[1]), ['가수1 / 타이틀1', '가수2 / 타이틀2']);
  assert.match(new PizZip(desk.buffer).file('word/document.xml').asText(), /<w:pgSz [^>]*w:orient="landscape"/);
  const web = mergeIntegratedForms({ station: 'PBC', files: [1, 2].map((n) => ({ name: `PBC_web_${n}.docx`, body: render(webTemplates, 'pbc-integrated.docx', n) })) });
  assert.equal(web.albums, 2); assert.deepEqual(web.warnings, []);
  // Desk 2.11–2.13 wrote 음원심의신청서 under the PBC name.
  const older = mergeIntegratedForms({ station: 'PBC', files: [1, 2].map((n) => ({ name: `PBC_old_${n}.docx`, body: render(deskTemplates, 'tbs-integrated.docx', n) })) });
  assert.match(older.warnings[0], /심의 음반 접수 목록/);
});

test('a portrait list from before 2.14 joins a landscape PBC list with the landscape column widths', () => {
  const landscape = render(deskTemplates, 'pbc-integrated.docx', 1);
  // The portrait list desk 2.11–2.13 wrote under the TBS name: other widths, 「가수명 / 타이틀명」 with spaces.
  const portraitZip = new PizZip(render(deskTemplates, 'pbc-integrated.docx', 2));
  const oldWidths = [900, 2800, 800, 1900, 1400, 1500];
  let index = 0;
  const portraitXml = portraitZip.file('word/document.xml').asText()
    .replace(/<w:pgSz [^>]*\/>/, '<w:pgSz w:w="11906" w:h="16838"/>')
    .replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, `<w:tblGrid>${oldWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`)
    .replace(/<w:tcW w:w="\d+"/g, () => `<w:tcW w:w="${oldWidths[index++ % 6]}"`)
    .replace('가수명/타이틀명', '가수명 / 타이틀명');
  portraitZip.file('word/document.xml', portraitXml);
  const merged = mergeIntegratedForms({ station: 'PBC', files: [{ name: 'new.docx', body: landscape }, { name: 'old.docx', body: portraitZip.generate({ type: 'nodebuffer' }) }] });
  assert.equal(merged.albums, 2); assert.deepEqual(merged.warnings, []);
  const xml = new PizZip(merged.buffer).file('word/document.xml').asText();
  assert.match(xml, /w:orient="landscape"/);
  const grid = [...xml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)[0].matchAll(/w:w="(\d+)"/g)].map((m) => m[1]);
  for (const [row] of xml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)) {
    assert.deepEqual([...row.matchAll(/<w:tcW w:w="(\d+)"/g)].map((m) => m[1]), grid);
  }
  assert.deepEqual(rowsOf(merged.buffer).slice(1).map((cells) => cells[1]), ['가수1 / 타이틀1', '가수2 / 타이틀2']);
});

test('the desk and the web use the same TBS and PBC forms', () => {
  for (const name of ['tbs-integrated.docx', 'pbc-integrated.docx', 'wbs-integrated.docx']) {
    const xml = (dir) => new PizZip(fs.readFileSync(path.join(dir, name))).file('word/document.xml').asText();
    assert.equal(xml(deskTemplates), xml(webTemplates), name);
  }
  // Owner 2026-11-15: TBS = 음원심의신청서 (portrait), PBC = 심의 음반 접수 목록 (landscape).
  const tbs = new PizZip(fs.readFileSync(path.join(deskTemplates, 'tbs-integrated.docx'))).file('word/document.xml').asText();
  const pbc = new PizZip(fs.readFileSync(path.join(deskTemplates, 'pbc-integrated.docx'))).file('word/document.xml').asText();
  assert.match(tbs, /음원심의신청서/); assert.doesNotMatch(tbs, /orient="landscape"/);
  assert.match(pbc, /심의 음반 접수 목록/); assert.match(pbc, /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>/);
});

test('mixed stations, single files and non-forms are refused', () => {
  const tbs = { name: 'a.docx', body: render(deskTemplates, 'tbs-integrated.docx', 1) };
  const wbs = { name: 'b.docx', body: render(deskTemplates, 'wbs-integrated.docx', 1) };
  const pbc = { name: 'c.docx', body: render(deskTemplates, 'pbc-integrated.docx', 1) };
  for (const input of [
    { station: 'TBS', files: [tbs] },
    { station: 'TBS', files: [tbs, pbc] },
    { station: 'WBS', files: [tbs, wbs] },
    { station: 'TBS', files: [wbs, wbs] },
    { station: 'KBS', files: [tbs, tbs] },
    { station: 'TBS', files: [tbs, { name: 'x.docx', body: Buffer.from('not a zip') }] },
    { station: 'TBS', files: [tbs, { name: 'x.hwp', body: Buffer.from('x') }] },
  ]) assert.throws(() => mergeIntegratedForms(input), IntegratedMergeError);
});
