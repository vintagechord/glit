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

test('TBS forms of several albums become one form with every album row in order', () => {
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

test('PBC and the web templates (TBS/PBC named the other way round) merge by table, with a warning', () => {
  const pbc = mergeIntegratedForms({ station: 'PBC', files: [1, 2].map((n) => ({ name: `PBC_${n}.docx`, body: render(deskTemplates, 'pbc-integrated.docx', n) })) });
  assert.equal(pbc.albums, 2); assert.deepEqual(pbc.warnings, []);
  const web = mergeIntegratedForms({ station: 'TBS', files: [1, 2].map((n) => ({ name: `TBS_web_${n}.docx`, body: render(webTemplates, 'tbs-integrated.docx', n) })) });
  assert.equal(web.albums, 2); assert.match(web.warnings[0], /웹 관리자/);
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
